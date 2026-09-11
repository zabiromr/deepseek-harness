/**
 * Drives the REAL plugin body: mounts `dsh-tool-self-reflect` on a real
 * `ToolRuntime` over an in-process memory store and invokes the registered
 * tool through `ctx.tools.execute`, with a fake parent Agent carrying a real
 * `Session` — so the scope and evidence defaults the tool derives from the
 * calling session are exercised on a genuine session identity.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import EphemeralMemory from '@deepseek-ai/dsh-memory-ephemeral'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
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

/**
 * A parent Agent backed by a real Session — the tool reads `agent.session`.
 * The session carries three completed turns, so seq 0 through 5 name real
 * events: the tool resolves every citation against the log, and a session with
 * an empty log can cite nothing.
 */
function agentWithSession(cwd?: string): Agent & { session: Session } {
  const id = SessionId('parent-1')
  const header: SessionHeader = cwd === undefined
    ? { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false }
    : { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd }
  const session = Session.create(id, undefined, header)
  seedTurns(session)
  return { id, session } as unknown as Agent & { session: Session }
}

/**
 * Append a short real log: a turn boundary, then a user message, then two more
 * completed turns. Seq 0 and 1 precede the session's first message, so they are
 * the session-opening events a citation may not consist of; seq 2 onward is
 * transcript.
 * @param session - the session to seed.
 */
function seedTurns(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'do the thing' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'recall returned **Run the formatter first**' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  for (const turn of [2, 3]) {
    session.append('turn/start', { turn })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
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

  // A citation is the lesson's only route back to what produced it, so the
  // identifier the model writes is a claim to resolve rather than a value to
  // store. A model that writes `current`, or any session it never saw, would
  // otherwise leave the lesson permanently unreplayable while still passing
  // the rule that evidence must be present.
  it('refuses a citation naming a session it cannot read', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A lesson',
      body: 'Body.',
      evidence: [{ session: 'current', seq: [3] }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("evidence names session 'current'")
    expect(await ctx.memory.recall({ limit: 10 })).toHaveLength(0)
  })

  // The session-opening events are appended before the session is asked to do
  // anything, so a citation made only of them resolves while evidencing
  // nothing — the failure that survived requiring citations to resolve.
  it('refuses evidence naming no event the turn produced', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A lesson',
      body: 'Body.',
      evidence: [{ seq: [0, 1] }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('names no event this turn produced by acting')
    expect(await ctx.memory.recall({ limit: 10 })).toHaveLength(0)
  })

  // The request that asked for the work is not the work: a citation that names
  // only it resolves and reaches the transcript while evidencing nothing, which
  // is how twelve of eighteen lessons in a real store came to cite the prompt.
  it('refuses evidence naming only the request that asked for the work', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A lesson',
      body: 'Body.',
      evidence: [{ seq: [0, 1, 2] }],
    })
    expect(result.isError).toBe(true)
    expect(await ctx.memory.recall({ limit: 10 })).toHaveLength(0)
  })

  it('accepts evidence naming what the turn produced, alongside anything else', async () => {
    const ctx = await setup()
    await call(ctx, {
      action: 'record',
      title: 'A lesson',
      body: 'Body.',
      evidence: [{ seq: [0, 2, 3] }],
    })
    expect(await ctx.memory.recall({ limit: 10 })).toHaveLength(1)
  })

  // A session that only opened has nothing a turn produced, so it can evidence
  // nothing — the citation resolves and is still refused.
  it('refuses a citation into a session that produced no work', async () => {
    const ctx = await setup()
    await ctx.plugin(SessionStore)
    const bare = ctx.sessions.create(SessionId('bare-1'))
    bare.append('turn/start', { turn: 1 })

    const result = await call(ctx, {
      action: 'record',
      title: 'A lesson',
      body: 'Body.',
      evidence: [{ session: 'bare-1', seq: [0] }],
    })

    expect(result.isError).toBe(true)
    expect(await ctx.memory.recall({ limit: 10 })).toHaveLength(0)
  })

  it('refuses a citation whose seq names no event in the session', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A lesson',
      body: 'Body.',
      evidence: [{ seq: [3, 99] }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('holds no event at seq 99')
    expect(await ctx.memory.recall({ limit: 10 })).toHaveLength(0)
  })

  it('accepts a citation naming another session the store can read', async () => {
    const ctx = await setup()
    await ctx.plugin(SessionStore)
    const other = ctx.sessions.create(SessionId('other-1'))
    seedTurns(other)

    await call(ctx, {
      action: 'record',
      title: 'A lesson',
      body: 'Body.',
      evidence: [{ session: 'other-1', seq: [3] }],
    })

    const stored = await ctx.memory.recall({ limit: 10 })
    expect(stored[0]?.evidence[0]?.session).toBe('other-1')
  })

  it('rejects a capture with no citation', async () => {
    const ctx = await setup()
    const result = await call(ctx, { action: 'record', title: 'A', body: 'B', evidence: [] })
    expect(result.isError).toBe(true)
    expect(await ctx.memory.recall({ limit: 10 })).toHaveLength(0)
  })

  it('rejects a capture missing its title or body', async () => {
    const ctx = await setup()
    const result = await call(ctx, { action: 'record', body: 'B', evidence: [{ seq: [3] }] })
    expect(result.isError).toBe(true)
  })

  it('rejects a body over the configured size', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A',
      body: 'x'.repeat(201),
      evidence: [{ seq: [3] }],
    })
    expect(result.isError).toBe(true)
  })

  it('accepts an explicit global scope when the deployment allows it', async () => {
    const ctx = await setup()
    await call(ctx, { action: 'record', title: 'A', body: 'B', scope: '*', evidence: [{ seq: [3] }] })
    expect((await ctx.memory.recall({ limit: 10 }))[0]?.scope).toBe('*')
  })

  it('refuses a global scope when the deployment forbids it', async () => {
    const ctx = await setup({ allowGlobalScope: false, maxBodyChars: 200 })
    const result = await call(ctx, {
      action: 'record',
      title: 'A',
      body: 'B',
      scope: '*',
      evidence: [{ seq: [3] }],
    })
    expect(result.isError).toBe(true)
  })

  it('rejects a call whose session names neither a scope nor a working directory', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      action: 'record',
      title: 'A',
      body: 'B',
      evidence: [{ seq: [3] }],
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
      evidence: [{ seq: [3] }],
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
  async function seed(ctx: Context, title = 'Run the formatter first'): Promise<string> {
    const lesson = await ctx.memory.record({
      scope: '/repo',
      title,
      body: 'B',
      evidence: [{ session: SessionId('s1'), seq: [1] }],
    })
    return lesson.id
  }

  it('confirms an existing lesson', async () => {
    const ctx = await setup()
    const id = await seed(ctx)
    const result = await call(ctx, { action: 'confirm', lesson_id: id, evidence: [{ seq: [3] }] })
    expect(result.isError).toBeFalsy()
    expect((await ctx.memory.get(id as never))?.confirmations).toBe(1)
  })

  it('contradicts an existing lesson and takes it out of the digest', async () => {
    const ctx = await setup()
    const id = await seed(ctx)
    await call(ctx, { action: 'contradict', lesson_id: id, evidence: [{ seq: [3] }] })
    expect((await ctx.memory.get(id as never))?.status).toBe('retired')
  })

  it('rejects a restatement with no lesson id', async () => {
    const ctx = await setup()
    const result = await call(ctx, { action: 'confirm', evidence: [{ seq: [3] }] })
    expect(result.isError).toBe(true)
  })

  // `confirm` and `contradict` both claim an outcome from having acted on a
  // lesson. A session the lesson never reached has no such outcome to report,
  // and without the check a stray call retires a sound lesson on evidence that
  // resolves and names work while saying nothing about that lesson.
  it('refuses to restate a lesson this session was never shown', async () => {
    const ctx = await setup()
    const id = await seed(ctx, 'A lesson nobody showed this session')

    const result = await call(ctx, { action: 'contradict', lesson_id: id, evidence: [{ seq: [3] }] })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('never shown the lesson')
    expect((await ctx.memory.get(id as never))?.contradictions).toBe(0)
  })

  // The digest is the other way a lesson reaches a session: rendered into the
  // system prompt rather than returned into the transcript.
  it('accepts a restatement of a lesson the digest carried', async () => {
    const ctx = await setup()
    const title = 'A lesson only the digest carried'
    const id = await seed(ctx, title)
    const agent = agentWithSession('/repo')
    agent.session.append('request/header', {
      header: { config: { provider: 'fixture', model: 'fixture-model' }, system: `- **${title}** — body` },
      reason: 'initial',
    })

    await call(ctx, { action: 'confirm', lesson_id: id, evidence: [{ seq: [3] }] }, agent)

    expect((await ctx.memory.get(id as never))?.confirmations).toBe(1)
  })

  // An agentless call has no session to have been shown anything, so the rule
  // has nothing to check; its citation must already name a readable session.
  it('restates without a calling session when the citation names one', async () => {
    const ctx = await setup()
    await ctx.plugin(SessionStore)
    const other = ctx.sessions.create(SessionId('other-2'))
    seedTurns(other)
    const id = await seed(ctx)

    await call(ctx, {
      action: 'confirm',
      lesson_id: id,
      evidence: [{ session: 'other-2', seq: [3] }],
    }, null)

    expect((await ctx.memory.get(id as never))?.confirmations).toBe(1)
  })

  it('rejects a restatement of an unknown lesson', async () => {
    const ctx = await setup()
    const result = await call(ctx, { action: 'confirm', lesson_id: 'absent', evidence: [{ seq: [3] }] })
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
      evidence: [{ seq: [3] }],
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
