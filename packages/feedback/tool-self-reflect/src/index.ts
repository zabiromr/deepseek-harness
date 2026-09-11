/**
 * Model-facing lesson capture: the write side of the learned-memory seam. The
 * tool records what to do differently, confirms a lesson later evidence
 * supports, and contradicts one later evidence refutes — always with citations
 * into the session log, because an uncitable lesson cannot be audited and so
 * must never re-enter a prompt.
 * @module @deepseek-ai/dsh-tool-self-reflect
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GLOBAL_SCOPE, MemoryError } from '@deepseek-ai/dsh-memory'
import type { Lesson, LessonEvidence, LessonId } from '@deepseek-ai/dsh-memory'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'tool-self-reflect'
export const inject = ['tools', 'memory']

/** Mount-time configuration. */
export interface Config {
  /**
   * Whether a lesson may be recorded against every workspace. A deployment
   * that runs one agent across unrelated projects usually wants this off, so a
   * lesson learned in one repository cannot surface in another.
   */
  allowGlobalScope: boolean
  /** Maximum characters accepted for one lesson body. */
  maxBodyChars: number
}

export const Config: z<Config> = z.object({
  allowGlobalScope: z.boolean().required(),
  maxBodyChars: z.natural().min(1).required(),
})

const DESCRIPTION =
  'Record a lesson learned from this session so later sessions inherit it, or restate an existing '
  + 'lesson against new evidence. Every call MUST cite the session events that justify it: pass the '
  + '`seq` numbers of the relevant events (from session history or the session-query tools). A lesson '
  + 'without citations is rejected. Use `record` when you learned something a future session should '
  + 'know — a wrong assumption you corrected, a project-specific convention, a tool that behaved '
  + 'unexpectedly. Use `confirm` when a lesson already in your prompt proved right again, and '
  + '`contradict` when it misled you; a contradicted lesson loses standing fast, so contradict '
  + 'promptly rather than silently working around a stale lesson. Write the lesson so it is '
  + 'actionable without this session for context: state the circumstance and what to do.'

/**
 * Resolve the session one citation points at.
 *
 * The identifier arrives as model-written JSON, so it is a claim rather than a
 * value: a model that writes `"current"`, or any session it never saw, would
 * otherwise have that string stored as the citation's identity and the lesson
 * could never be replayed. Only the calling session or one this harness can
 * read resolves; anything else is refused with the name it supplied.
 * @param requested - Session identifier as the model wrote it, when any.
 * @param calling - Session of the calling agent, when there is one.
 * @param lookup - Reader for a session other than the calling one.
 * @returns the session the citation resolves to.
 * @throws MemoryError `invalid-evidence` when no session resolves.
 */
function resolveCitedSession(
  requested: string | undefined,
  calling: Session | undefined,
  lookup: (id: SessionId) => Session | undefined,
): Session {
  if (requested === undefined || requested === calling?.id) {
    if (calling === undefined) {
      throw new MemoryError(
        'invalid-evidence',
        'evidence must name a session when the call has no owning agent session',
      )
    }
    return calling
  }
  const found = lookup(requested as SessionId)
  if (found === undefined) {
    throw new MemoryError(
      'invalid-evidence',
      `evidence names session '${requested}', which this harness cannot read;`
      + ' omit `session` to cite the session making the call',
    )
  }
  return found
}

/**
 * Event types a turn produces by acting.
 *
 * A session accumulates events whatever happens: it is configured, a turn
 * opens, a step starts, a title is requested. Those exist before and beside
 * any work, so a citation assembled from them resolves while evidencing
 * nothing — as does one naming only the message that asked for the work.
 * These three are what a turn adds by doing something: what the model said,
 * what it called, and what the call answered.
 *
 * The set is small and closed on purpose. A plugin-owned event is not accepted
 * on its own, because this cannot know what a contributed type means; a lesson
 * resting on one cites it beside the call that produced it.
 */
const EVIDENTIAL_TYPES: ReadonlySet<string> = new Set([
  'assistant/message',
  'tool/call',
  'tool/result',
])

/**
 * Resolve the citations a call supplies against the sessions that hold them.
 *
 * A citation is the lesson's only route back to what produced it, so each one
 * is resolved rather than recorded as written: the session must resolve, and
 * every sequence number must name an event that session actually holds. A
 * citation that survives can be replayed; one that does not is refused here,
 * because a lesson carrying unreplayable evidence passes the citation rule
 * while satisfying nothing it exists to guarantee.
 * @param raw - Citations as the model wrote them.
 * @param calling - Session of the calling agent, when there is one.
 * @param lookup - Reader for a session other than the calling one.
 * @returns the resolved citations, each naming a real session and real events.
 * @throws MemoryError `invalid-evidence` when a session or an event does not resolve.
 */
function resolveEvidence(
  raw: readonly { session?: string; seq: readonly number[] }[],
  calling: Session | undefined,
  lookup: (id: SessionId) => Session | undefined,
): LessonEvidence[] {
  const resolved: LessonEvidence[] = []
  let carriesWork = false
  for (const citation of raw) {
    const source = resolveCitedSession(citation.session, calling, lookup)
    for (const seq of citation.seq) {
      if (!Number.isInteger(seq) || seq < 0 || source.eventAt(SessionSeq(seq)) === undefined) {
        throw new MemoryError(
          'invalid-evidence',
          `session '${source.id}' holds no event at seq ${seq};`
          + ' list real ones with `session_event_search` rather than guessing',
        )
      }
    }
    for (const seq of citation.seq) {
      const event = source.eventAt(SessionSeq(seq))
      if (event !== undefined && EVIDENTIAL_TYPES.has(event.type)) carriesWork = true
    }
    resolved.push({ session: source.id, seq: [...citation.seq] })
  }
  if (!carriesWork) {
    throw new MemoryError(
      'invalid-evidence',
      'evidence names no event this turn produced by acting; cite an assistant message, a tool'
      + ' call, or a tool result, not only the request and the session-opening events. Find one'
      + ' with `session_event_search`: omit `session_id`, and pass `event_types` of `tool/call`'
      + ' and `tool/result`.',
    )
  }
  return resolved
}

/**
 * Resolve the scope one capture applies to.
 * @param requested - Scope the model asked for, when any.
 * @param cwd - Working directory of the calling session, when known.
 * @param allowGlobal - Whether this deployment permits globally-scoped lessons.
 * @returns the scope to store.
 * @throws MemoryError `invalid-request` for a global scope the deployment forbids, or when no scope can be resolved.
 */
function resolveScope(
  requested: string | undefined,
  cwd: string | undefined,
  allowGlobal: boolean,
): string {
  if (requested === GLOBAL_SCOPE) {
    if (!allowGlobal) {
      throw new MemoryError('invalid-request', 'this deployment does not allow globally-scoped lessons')
    }
    return GLOBAL_SCOPE
  }
  const scope = requested ?? cwd
  if (scope === undefined) {
    throw new MemoryError('invalid-request', 'no workspace scope is available; pass `scope` explicitly')
  }
  return scope
}

/**
 * Refuse a restatement of a lesson this session was never shown.
 *
 * `confirm` and `contradict` both claim an outcome from having acted on a
 * lesson: it proved right again, or it misled. Neither claim is available to a
 * session the lesson never reached. Without the check a stray call retires a
 * sound lesson on evidence that resolves and names work while saying nothing
 * about that lesson — which is how two well-cited lessons were retired in one
 * afternoon by a model asked to correct a third.
 *
 * A lesson reaches a session two ways, and both count: the digest renders it
 * into the system prompt, and the recall tool returns it into the transcript.
 * @param session - Session of the calling agent, when there is one.
 * @param title - Title of the lesson being restated.
 * @throws MemoryError `invalid-request` when the lesson never appeared.
 */
function assertLessonWasShown(session: Session | undefined, title: string): void {
  if (session === undefined) return
  if ((session.requestHeader()?.system ?? '').includes(title)) return
  if (JSON.stringify(session.deriveMessages()).includes(title)) return
  throw new MemoryError(
    'invalid-request',
    `this session was never shown the lesson '${title}', so it cannot report how it fared;`
    + ' recall it with `tool-knowledge-base` first, or restate it from a session that carried it',
  )
}

/** Canonical result of one capture or restatement. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lesson_id: { type: 'string', required: true, description: 'Identity of the recorded or restated lesson.' },
    title: { type: 'string', required: true, description: 'The lesson title as stored.' },
    scope: { type: 'string', required: true, description: 'Workspace the lesson applies to, or `*` for every workspace.' },
    status: {
      type: 'string',
      required: true,
      enum: ['active', 'dormant', 'retired'],
      description: 'Standing after the call: only `active` lessons appear in a later prompt digest.',
    },
    confirmations: { type: 'integer', required: true, description: 'How many times evidence has confirmed this lesson.' },
    contradictions: { type: 'integer', required: true, description: 'How many times evidence has contradicted it.' },
  },
} as const

/**
 * Project a stored lesson onto the tool result.
 * @param lesson - The stored lesson.
 * @returns the canonical result value.
 */
function toResult(lesson: Lesson): {
  lesson_id: string
  title: string
  scope: string
  status: 'active' | 'dormant' | 'retired'
  confirmations: number
  contradictions: number
} {
  return {
    lesson_id: lesson.id,
    title: lesson.title,
    scope: lesson.scope,
    status: lesson.status,
    confirmations: lesson.confirmations,
    contradictions: lesson.contradictions,
  }
}

/**
 * Register the capture tool.
 * @param ctx - Cordis context carrying the tool registry and memory service.
 * @param config - Validated scope and size policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'tool-self-reflect',
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['record', 'confirm', 'contradict'],
        description: 'Capture a new lesson, or restate an existing one against new evidence.',
      },
      title: {
        type: 'string',
        description: 'One line stating what to do differently. Required for `record`.',
      },
      body: {
        type: 'string',
        description: 'The lesson: the circumstance it applies to and the action to take. Required for `record`.',
      },
      lesson_id: {
        type: 'string',
        description: 'The lesson being restated. Required for `confirm` and `contradict`.',
      },
      scope: {
        type: 'string',
        description: 'Workspace the lesson applies to. Defaults to this session\'s working directory; `*` means every workspace.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional retrieval tags.',
      },
      evidence: {
        type: 'array',
        required: true,
        description: 'Citations justifying this call; never empty.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            session: {
              type: 'string',
              description:
                'Session holding the cited events. Omit it to cite this session; pass one only when'
                + ' citing another session by the id that session reported.',
            },
            seq: {
              type: 'array',
              required: true,
              items: { type: 'integer' },
              description:
                'Sequence numbers of the cited events, ascending. Each must name an event that'
                + ' session holds, and at least one must be an assistant message, a tool call, or a'
                + ' tool result: citing only the request and the session-opening events is refused.'
                + ' Find them with `session_event_search`, omitting `session_id` for this session and'
                + ' passing `event_types` of `tool/call` and `tool/result`; the session log files are'
                + ' a compressed container and reading them directly is slower and error-prone.',
            },
          },
        },
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `lesson ${value.lesson_id} (${value.status}): ${value.title}`
          + ` — ${value.confirmations} confirmed, ${value.contradictions} contradicted`,
      }],
    },
    async execute(args, exec: ToolRunContext) {
      const session = exec.agent?.session
      // Read at call time: the store may mount after this plugin, and a
      // composition without it can still cite the calling session.
      const sessions = ctx.get('sessions')
      const evidence = resolveEvidence(args.evidence, session, id => sessions?.get(id))
      if (args.action === 'record') {
        if (args.title === undefined || args.body === undefined) {
          throw new MemoryError('invalid-request', 'record requires both `title` and `body`')
        }
        if (args.body.length > config.maxBodyChars) {
          throw new MemoryError(
            'invalid-request',
            `lesson body is ${args.body.length} characters, over the ${config.maxBodyChars} limit`,
          )
        }
        const lesson = await ctx.memory.record({
          scope: resolveScope(args.scope, session?.header.cwd, config.allowGlobalScope),
          title: args.title,
          body: args.body,
          evidence,
          tags: args.tags ?? [],
        })
        return toResult(lesson)
      }
      if (args.lesson_id === undefined) {
        throw new MemoryError('invalid-request', `${args.action} requires \`lesson_id\``)
      }
      const id = args.lesson_id as LessonId
      const stored = await ctx.memory.get(id)
      if (stored === undefined) {
        throw new MemoryError('not-found', `no lesson with id '${args.lesson_id}'`)
      }
      assertLessonWasShown(session, stored.title)
      const lesson = args.action === 'confirm'
        ? await ctx.memory.confirm(id, evidence)
        : await ctx.memory.contradict(id, evidence)
      return toResult(lesson)
    },
  }))
}
