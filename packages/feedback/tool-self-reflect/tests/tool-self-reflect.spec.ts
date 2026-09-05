/**
 * Drives the REAL plugin body: mounts `dsh-tool-self-reflect` on a real
 * `ToolRuntime` over an in-process memory store and invokes the registered
 * tool through `ctx.tools.execute`, with a fake parent Agent carrying a real
 * `Session` — so the scope and evidence defaults the tool derives from the
 * calling session are exercised on a genuine session identity.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import EphemeralMemory from '@deepseek-ai/dsh-memory-ephemeral'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as tool from '../src/index.ts'

const DAY = 24 * 60 * 60 * 1000
const MEMORY = { halfLifeMs: 30 * DAY, dormantFloor: 0.25, retireFloor: 0.05 }
const CONFIG = { allowGlobalScope: true, maxBodyChars: 200 }
const signal = new AbortController().signal

let context: Context | undefined
let calls = 0

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/** A parent Agent backed by a real Session — the tool reads `agent.session`. */
function agentWithSession(cwd?: string): Agent & { session: Session } {
  const id = SessionId('parent-1')
  const header: SessionHeader = cwd === undefined
    ? { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false }
    : { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd }
  const session = Session.create(id, undefined, header)
  return { id, session } as unknown as Agent & { session: Session }
}

/**
 * Mount the tool over an in-process memory store.
 * @param config - Tool config override.
 * @returns the mounted context.
 */
async function setup(config = CONFIG): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(EphemeralMemory, MEMORY)
  await ctx.plugin(tool, config)
  return ctx
}

/**
 * Invoke the reflection tool.
 * @param ctx - The mounted context.
 * @param args - Model-supplied arguments.
 * @param agent - Calling agent, or null for an agentless call.
 * @returns the tool result.
 */
function call(ctx: Context, args: unknown, agent: Agent | null = agentWithSession('/repo')) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${++calls}`),
    name: 'tool-self-reflect',
    arguments: args,
    ...agent === null ? {} : { agent },
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('recording a lesson', () => {
  it('stores a cited lesson scoped to the calling session workspace', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'Run the formatter',
      body: 'The repository formatter rejects tabs.',
      evidence: [{ seq: [3, 5] }],
    })
    expect(result.isError).toBeFalsy()
    const stored = await ctx.memory.recall({ limit: 10 })
    expect(stored).toHaveLength(1)
    expect(stored[0]?.scope).toBe('/repo')
  })

  it('defaults each citation to the calling session, so the model need only name event numbers', async () => {
    const ctx = await setup()
    await call(ctx, { action: 'record', title: 'A lesson', body: 'Body.', evidence: [{ seq: [3] }] })
    const stored = await ctx.memory.recall({ limit: 10 })
    expect(stored[0]?.evidence[0]?.session).toBe('parent-1')
  })

  it('keeps an explicit session on a citation', async () => {
    const ctx = await setup()
    await call(ctx, {
      action: 'record',
      title: 'A lesson',
      body: 'Body.',
      evidence: [{ session: 'other-session', seq: [3] }],
    })
    const stored = await ctx.memory.recall({ limit: 10 })
    expect(stored[0]?.evidence[0]?.session).toBe('other-session')
  })

  it('rejects a capture with no citation', async () => {
    const ctx = await setup()
    const result = await call(ctx, { action: 'record', title: 'A', body: 'B', evidence: [] })
    expect(result.isError).toBe(true)
    expect(await ctx.memory.recall({ limit: 10 })).toHaveLength(0)
  })

  it('rejects a capture missing its title or body', async () => {
    const ctx = await setup()
    const result = await call(ctx, { action: 'record', body: 'B', evidence: [{ seq: [1] }] })
    expect(result.isError).toBe(true)
  })

  it('rejects a body over the configured size', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A',
      body: 'x'.repeat(201),
      evidence: [{ seq: [1] }],
    })
    expect(result.isError).toBe(true)
  })

  it('accepts an explicit global scope when the deployment allows it', async () => {
    const ctx = await setup()
    await call(ctx, { action: 'record', title: 'A', body: 'B', scope: '*', evidence: [{ seq: [1] }] })
    expect((await ctx.memory.recall({ limit: 10 }))[0]?.scope).toBe('*')
  })

  it('refuses a global scope when the deployment forbids it', async () => {
    const ctx = await setup({ allowGlobalScope: false, maxBodyChars: 200 })
    const result = await call(ctx, {
      action: 'record',
      title: 'A',
      body: 'B',
      scope: '*',
      evidence: [{ seq: [1] }],
    })
    expect(result.isError).toBe(true)
  })

  it('rejects a call whose session names neither a scope nor a working directory', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A',
      body: 'B',
      evidence: [{ seq: [1] }],
    }, agentWithSession())
    expect(result.isError).toBe(true)
  })

  it('rejects an agentless call that cites no session, having none to infer', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A',
      body: 'B',
      scope: '/repo',
      evidence: [{ seq: [1] }],
    }, null)
    expect(result.isError).toBe(true)
  })
})

describe('restating a lesson', () => {
  /**
   * Record one lesson directly on the service.
   * @param ctx - The mounted context.
   * @returns the stored lesson id.
   */
  async function seed(ctx: Context): Promise<string> {
    const lesson = await ctx.memory.record({
      scope: '/repo',
      title: 'A',
      body: 'B',
      evidence: [{ session: SessionId('s1'), seq: [1] }],
    })
    return lesson.id
  }

  it('confirms an existing lesson', async () => {
    const ctx = await setup()
    const id = await seed(ctx)
    const result = await call(ctx, { action: 'confirm', lesson_id: id, evidence: [{ seq: [9] }] })
    expect(result.isError).toBeFalsy()
    expect((await ctx.memory.get(id as never))?.confirmations).toBe(1)
  })

  it('contradicts an existing lesson and takes it out of the digest', async () => {
    const ctx = await setup()
    const id = await seed(ctx)
    await call(ctx, { action: 'contradict', lesson_id: id, evidence: [{ seq: [9] }] })
    expect((await ctx.memory.get(id as never))?.status).toBe('retired')
  })

  it('rejects a restatement with no lesson id', async () => {
    const ctx = await setup()
    const result = await call(ctx, { action: 'confirm', evidence: [{ seq: [9] }] })
    expect(result.isError).toBe(true)
  })

  it('rejects a restatement of an unknown lesson', async () => {
    const ctx = await setup()
    const result = await call(ctx, { action: 'confirm', lesson_id: 'absent', evidence: [{ seq: [9] }] })
    expect(result.isError).toBe(true)
  })
})

describe('what the model sees', () => {
  it('renders the standing so the model can tell a confirmation landed', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'Run the formatter',
      body: 'B',
      evidence: [{ seq: [1] }],
    })
    expect(text(result)).toContain('Run the formatter')
    expect(text(result)).toContain('0 confirmed')
  })

  it('offers exactly the three documented actions', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(entry => entry.name === 'tool-self-reflect')
    const action = (schema?.parameters as { properties: { action: { enum: string[] } } }).properties.action
    expect(action.enum).toEqual(['record', 'confirm', 'contradict'])
  })
})
