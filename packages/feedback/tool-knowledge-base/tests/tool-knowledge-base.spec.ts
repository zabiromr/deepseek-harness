/**
 * Drives the REAL plugin body: mounts `dsh-tool-knowledge-base` on a real
 * `ToolRuntime` over an in-process memory store and searches through
 * `ctx.tools.execute`, with a fake parent Agent carrying a real `Session` — so
 * the workspace pinning the tool derives from the caller is exercised on a
 * genuine session identity.
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
const CONFIG = { maxResults: 3, allowCrossWorkspace: false }
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
 * Invoke the recall tool.
 * @param ctx - The mounted context.
 * @param args - Model-supplied arguments.
 * @param agent - Calling agent, or null for an agentless call.
 * @returns the tool result.
 */
function call(ctx: Context, args: unknown, agent: Agent | null = agentWithSession('/repo')) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${++calls}`),
    name: 'tool-knowledge-base',
    arguments: args,
    ...agent === null ? {} : { agent },
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Record one lesson directly on the service.
 * @param ctx - The mounted context.
 * @param overrides - Fields to replace.
 */
async function seed(
  ctx: Context,
  overrides: { scope?: string; title?: string; body?: string; tags?: string[] } = {},
): Promise<void> {
  await ctx.memory.record({
    scope: overrides.scope ?? '/repo',
    title: overrides.title ?? 'Run the formatter',
    body: overrides.body ?? 'The repository formatter rejects tabs.',
    evidence: [{ session: SessionId('s1'), seq: [3] }],
    ...overrides.tags === undefined ? {} : { tags: overrides.tags },
  })
}

describe('searching lessons', () => {
  it('returns a matching lesson with the evidence behind it', async () => {
    const ctx = await setup()
    await seed(ctx)
    const result = await call(ctx, { text: 'formatter' })
    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain('Run the formatter')
  })

  it('reports plainly when nothing matches', async () => {
    const ctx = await setup()
    const result = await call(ctx, { text: 'nothing-matches' })
    expect(text(result)).toBe('No matching lessons.')
  })

  it('lists by standing when no query is given', async () => {
    const ctx = await setup()
    await seed(ctx)
    expect(text(await call(ctx, {}))).toContain('Run the formatter')
  })

  it('filters by tag', async () => {
    const ctx = await setup()
    await seed(ctx, { tags: ['build'] })
    expect(text(await call(ctx, { tags: ['absent'] }))).toBe('No matching lessons.')
  })

  it('reaches lessons that have faded out of the digest', async () => {
    const ctx = await setup()
    await seed(ctx)
    await ctx.memory.reclassify(Date.now() + 300 * DAY)
    expect(text(await call(ctx, { statuses: ['retired'] }))).toContain('Run the formatter')
  })
})

describe('workspace pinning', () => {
  it('hides a lesson recorded for another workspace', async () => {
    const ctx = await setup()
    await seed(ctx, { scope: '/elsewhere', title: 'Foreign lesson' })
    expect(text(await call(ctx, {}))).toBe('No matching lessons.')
  })

  it('still shows globally-scoped lessons', async () => {
    const ctx = await setup()
    await seed(ctx, { scope: '*', title: 'Global lesson' })
    expect(text(await call(ctx, {}))).toContain('Global lesson')
  })

  it('searches every workspace when the deployment allows it', async () => {
    const ctx = await setup({ maxResults: 3, allowCrossWorkspace: true })
    await seed(ctx, { scope: '/elsewhere', title: 'Foreign lesson' })
    expect(text(await call(ctx, {}))).toContain('Foreign lesson')
  })

  it('falls back to the global scope when the caller has no workspace', async () => {
    const ctx = await setup()
    await seed(ctx, { scope: '*', title: 'Global lesson' })
    await seed(ctx, { scope: '/repo', title: 'Workspace lesson' })
    const rendered = text(await call(ctx, {}, agentWithSession()))
    expect(rendered).toContain('Global lesson')
    expect(rendered).not.toContain('Workspace lesson')
  })

  it('serves an agentless call from the global scope', async () => {
    const ctx = await setup()
    await seed(ctx, { scope: '*', title: 'Global lesson' })
    expect(text(await call(ctx, {}, null))).toContain('Global lesson')
  })
})

describe('result caps', () => {
  it('caps results at the deployment maximum even when the model asks for more', async () => {
    const ctx = await setup()
    await seed(ctx, { title: 'One' })
    await seed(ctx, { title: 'Two' })
    await seed(ctx, { title: 'Three' })
    await seed(ctx, { title: 'Four' })
    const result = await call(ctx, { limit: 100 })
    expect(text(result).split('\n- ')).toHaveLength(3)
  })

  it('honours a smaller limit the model asks for', async () => {
    const ctx = await setup()
    await seed(ctx, { title: 'One' })
    await seed(ctx, { title: 'Two' })
    expect(text(await call(ctx, { limit: 1 })).split('\n- ')).toHaveLength(1)
  })
})

describe('what the model sees', () => {
  it('offers the three documented standings', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(entry => entry.name === 'tool-knowledge-base')
    const statuses = (schema?.parameters as {
      properties: { statuses: { items: { enum: string[] } } }
    }).properties.statuses
    expect(statuses.items.enum).toEqual(['active', 'dormant', 'retired'])
  })
})

describe('scheduling', () => {
  it('classifies a search as parallel-safe, being read-only', async () => {
    const ctx = await setup()
    const mode = ctx.tools.executionMode({
      signal,
      callId: ToolCallId('mode-1'),
      name: 'tool-knowledge-base',
      arguments: {},
      agent: agentWithSession('/repo'),
    })
    expect(mode.kind).toBe('parallel')
  })

  it('lets concurrent searches overlap', async () => {
    const ctx = await setup()
    await seed(ctx)
    const results = await Promise.all([call(ctx, {}), call(ctx, {}), call(ctx, {})])
    for (const result of results) expect(result.isError).toBeFalsy()
  })
})
