/**
 * Model-facing lesson recall: the read side of the learned-memory seam. The
 * always-on prompt digest carries only the highest-standing active lessons, so
 * this tool exists for the cases the digest cannot serve — searching by topic,
 * reading a lesson's full evidence, and reaching lessons that have decayed out
 * of the digest but remain on the record.
 * @module @deepseek-ai/dsh-tool-knowledge-base
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GLOBAL_SCOPE } from '@deepseek-ai/dsh-memory'
import type { Lesson, LessonStatus } from '@deepseek-ai/dsh-memory'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'tool-knowledge-base'
export const inject = ['tools', 'memory']

/** Mount-time configuration. */
export interface Config {
  /** Maximum lessons one call may return, whatever the model asks for. */
  maxResults: number
  /**
   * Whether a search may reach lessons recorded for other workspaces. Off
   * keeps every result scoped to the calling session's workspace plus the
   * global scope.
   */
  allowCrossWorkspace: boolean
}

export const Config: z<Config> = z.object({
  maxResults: z.natural().min(1).required(),
  allowCrossWorkspace: z.boolean().required(),
})

const DESCRIPTION =
  'Search the lessons recorded by earlier sessions. Your prompt already carries the highest-standing '
  + 'active lessons for this workspace, so reach for this tool when you need something the digest does '
  + 'not show: lessons about a specific topic, the evidence behind a lesson you want to act on, or '
  + 'lessons that have faded (`dormant` or `retired`) but may still apply. Results carry the citations '
  + 'that justified each lesson, so you can read the original session events before trusting one. To '
  + 'change a lesson\'s standing, use the reflection tool rather than this one.'

/** Canonical result: the matching lessons with their citations. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lessons: {
      type: 'array',
      required: true,
      description: 'Matching lessons, highest standing first.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lesson_id: { type: 'string', required: true, description: 'Identity, for confirming or contradicting it later.' },
          title: { type: 'string', required: true, description: 'One line stating what to do differently.' },
          body: { type: 'string', required: true, description: 'The lesson itself.' },
          scope: { type: 'string', required: true, description: 'Workspace it applies to, or `*` for every workspace.' },
          status: {
            type: 'string',
            required: true,
            enum: ['active', 'dormant', 'retired'],
            description: 'Current standing; only `active` lessons reach the prompt digest.',
          },
          tags: { type: 'array', required: true, items: { type: 'string' }, description: 'Retrieval tags.' },
          confirmations: { type: 'integer', required: true, description: 'How many times evidence confirmed it.' },
          contradictions: { type: 'integer', required: true, description: 'How many times evidence contradicted it.' },
          evidence: {
            type: 'array',
            required: true,
            description: 'Citations justifying the lesson.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                session: { type: 'string', required: true, description: 'Session holding the cited events.' },
                seq: { type: 'array', required: true, items: { type: 'integer' }, description: 'Cited event sequence numbers.' },
              },
            },
          },
        },
      },
    },
  },
} as const

/**
 * Project one stored lesson onto the tool result.
 * @param lesson - The stored lesson.
 * @returns the canonical result item.
 */
function toItem(lesson: Lesson): {
  lesson_id: string
  title: string
  body: string
  scope: string
  status: LessonStatus
  tags: string[]
  confirmations: number
  contradictions: number
  evidence: { session: string; seq: number[] }[]
} {
  return {
    lesson_id: lesson.id,
    title: lesson.title,
    body: lesson.body,
    scope: lesson.scope,
    status: lesson.status,
    tags: [...lesson.tags],
    confirmations: lesson.confirmations,
    contradictions: lesson.contradictions,
    evidence: lesson.evidence.map(citation => ({ session: citation.session, seq: [...citation.seq] })),
  }
}

/**
 * Register the recall tool.
 * @param ctx - Cordis context carrying the tool registry and memory service.
 * @param config - Validated result cap and scope policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'tool-knowledge-base',
    description: DESCRIPTION,
    parameters: {
      text: {
        type: 'string',
        description: 'Case-insensitive substring matched against title, body, and tags. Omit to list by standing alone.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only lessons carrying every listed tag.',
      },
      statuses: {
        type: 'array',
        items: { type: 'string', enum: ['active', 'dormant', 'retired'] },
        description: 'Standings to include. Omit to search every standing, including faded lessons.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum lessons to return; capped by the deployment.',
      },
    },
    isConcurrencySafe: () => true,
    execute(args, exec: ToolRunContext) {
      const cwd = exec.agent?.session.header.cwd
      const limit = Math.min(args.limit ?? config.maxResults, config.maxResults)
      // Without cross-workspace search the query is pinned to the calling
      // session's workspace; the provider always admits globally-scoped
      // lessons alongside it.
      const scope = config.allowCrossWorkspace ? undefined : cwd ?? GLOBAL_SCOPE
      return ctx.memory
        .recall({
          ...(args.text === undefined ? {} : { text: args.text }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
          ...(args.statuses === undefined ? {} : { statuses: args.statuses }),
          ...(scope === undefined ? {} : { scope }),
          limit,
        })
        .then(lessons => ({ lessons: lessons.map(toItem) }))
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value.lessons.length === 0
          ? 'No matching lessons.'
          : value.lessons
            .map(item => `- [${item.status}] ${item.title} (${item.lesson_id})\n  ${item.body}`)
            .join('\n'),
      }],
    },
  }))
}
