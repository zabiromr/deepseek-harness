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
import type { SessionId } from '@deepseek-ai/dsh-session'
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
 * Resolve the citations a call supplies, defaulting each to the calling
 * session so the model only has to name event sequence numbers.
 * @param raw - Citations as the model wrote them.
 * @param fallback - Session id of the calling agent, when there is one.
 * @returns the resolved citations.
 * @throws MemoryError `invalid-evidence` when a citation names no session and none can be inferred.
 */
function resolveEvidence(
  raw: readonly { session?: string; seq: readonly number[] }[],
  fallback: SessionId | undefined,
): LessonEvidence[] {
  return raw.map((citation) => {
    const session = citation.session ?? fallback
    if (session === undefined) {
      throw new MemoryError(
        'invalid-evidence',
        'evidence must name a session when the call has no owning agent session',
      )
    }
    return { session: session as SessionId, seq: [...citation.seq] }
  })
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
              description: 'Session holding the cited events. Defaults to the current session.',
            },
            seq: {
              type: 'array',
              required: true,
              items: { type: 'integer' },
              description: 'Sequence numbers of the cited events, ascending.',
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
      const evidence = resolveEvidence(args.evidence, session?.id)
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
      const lesson = args.action === 'confirm'
        ? await ctx.memory.confirm(id, evidence)
        : await ctx.memory.contradict(id, evidence)
      return toResult(lesson)
    },
  }))
}
