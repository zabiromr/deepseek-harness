/**
 * The always-on learned-lesson digest: a bounded system-prompt section built
 * from `ctx.memory`, so accumulated lessons reach a later session without the
 * model having to remember to ask for them.
 * @module @deepseek-ai/dsh-memory-prompt
 */

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Lesson } from '@deepseek-ai/dsh-memory'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { renderDigest } from './render.ts'

export { DIGEST_HEADING, DIGEST_PREAMBLE, renderDigest, renderLesson } from './render.ts'

/** Cordis plugin name. */
export const name = 'memory-prompt'
/** Services required before the digest can mount. */
export const inject = ['systemPrompt', 'memory']

/**
 * Placement of the digest among first-party sections. Learned lessons qualify
 * the instructions that follow them, so they sit ahead of tool and capability
 * sections and behind the identity and safety text those sections assume.
 */
export const DIGEST_SECTION_ORDER = -50

/**
 * Plugin config. Both budget fields are deployment choices with no universally
 * correct value: how many lessons are worth their tokens depends on the model's
 * context budget and how much other first-party text a composition mounts.
 */
export interface Config {
  /** Maximum lessons considered for the digest, highest standing first. */
  maxLessons: number
  /** Character budget for the rendered section, heading and preamble included. */
  maxChars: number
}

export const Config: s<Config> = s.object({
  maxLessons: s.natural().min(1).required(),
  maxChars: s.natural().min(1).required(),
})

/**
 * Describe a thrown value for one log line.
 * @param error - The rejected value.
 * @returns its message, or its string form when it is not an Error.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Mount the digest section.
 *
 * Prompt sections render synchronously while lesson selection is asynchronous,
 * so the section serves a cached snapshot and schedules a refresh after each
 * assembly. The digest is therefore at most one assembly stale — which is the
 * correct trade here, because its purpose is carrying lessons from EARLIER
 * sessions, not reflecting a lesson recorded moments ago in this one.
 * @param ctx - Cordis context carrying the system-prompt registry and memory service.
 * @param config - Validated budget config.
 */
export function apply(ctx: Context, config: Config): void {
  // The running workspace, not a tunable: lessons are scoped to the directory
  // the harness was launched in, alongside globally-scoped lessons.
  const scope = process.cwd()
  let cached = ''
  let refreshing: Promise<void> | undefined

  const refresh = (): Promise<void> => {
    if (refreshing !== undefined) return refreshing
    const run = ctx.memory
      .digest({ scope, maxLessons: config.maxLessons })
      .then((lessons: readonly Lesson[]) => {
        cached = renderDigest(lessons, config.maxChars)
      })
      .catch((error: unknown) => {
        // A memory store that cannot be read must not fail prompt assembly:
        // the harness is fully usable without a digest, so the section degrades
        // to empty and the next assembly retries.
        ctx.logger.warn(`memory-prompt: digest refresh failed: ${describe(error)}`)
        cached = ''
      })
      .finally(() => {
        refreshing = undefined
      })
    refreshing = run
    return run
  }

  const section: PromptSection = {
    name: 'memory-digest',
    order: DIGEST_SECTION_ORDER,
    text: () => {
      void refresh()
      return cached
    },
  }
  ctx.effect(() => ctx.systemPrompt.section(section), 'memory-prompt.section')
  void refresh()
}
