/**
 * The self-improvement prompt section: tells the model when to record a lesson
 * and when to restate one, so capture happens at the moments that produce
 * durable knowledge rather than whenever the model happens to think of it.
 * @module @deepseek-ai/dsh-self-improve-prompt
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

export const name = 'self-improve-prompt'
export const inject = ['systemPrompt']

/**
 * Configuration for the self-improvement prompt section. Each flag gates one
 * independently useful piece of guidance: a composition that mounts the
 * capture tool without the recall tool wants the first and not the second.
 */
export interface Config {
  /** Explain when a lesson is worth recording. */
  showReflectionGuidance: boolean
  /** Explain how to restate a lesson the digest already carries. */
  showRestatementGuidance: boolean
  /** Explain when to search beyond the always-on digest. */
  showRecallGuidance: boolean
}

export const Config: z<Config> = z.object({
  showReflectionGuidance: z.boolean().required(),
  showRestatementGuidance: z.boolean().required(),
  showRecallGuidance: z.boolean().required(),
})

const REFLECTION =
  '# Recording lessons\n\n'
  + 'Record a lesson when this session produced knowledge a later session would otherwise have to '
  + 'rediscover: an assumption that turned out wrong, a convention specific to this project, a tool '
  + 'or command that behaved unexpectedly, or a approach that worked after simpler ones failed. Do '
  + 'not record the task you performed, a summary of what you changed, or anything already written '
  + 'in the repository — those are in the log and the code. Every lesson must cite the session '
  + 'events that justify it; a lesson you cannot cite is one you should not record.'

const RESTATEMENT =
  '# Restating lessons\n\n'
  + 'The lessons in your prompt are evidence from earlier sessions, not standing orders. When one '
  + 'proves right again, confirm it — confirmation is the only thing that keeps a lesson from fading. '
  + 'When one misleads you, contradict it promptly and cite what actually happened, rather than '
  + 'silently working around it: an uncontradicted wrong lesson keeps costing later sessions.'

const RECALL =
  '# Searching past lessons\n\n'
  + 'Your prompt carries only the highest-standing lessons for this workspace. Search the full record '
  + 'when you need lessons on a specific topic, the evidence behind one before you act on it, or '
  + 'lessons that have faded but may still apply to unusual work.'

/**
 * Compose the section text for one configuration.
 * @param config - Which guidance the deployment mounts.
 * @returns the section content, empty when every flag is off.
 */
export function getPromptSection(config: Config): string {
  const parts: string[] = []
  if (config.showReflectionGuidance) parts.push(REFLECTION)
  if (config.showRestatementGuidance) parts.push(RESTATEMENT)
  if (config.showRecallGuidance) parts.push(RECALL)
  return parts.join('\n\n')
}

/**
 * Placement among first-party sections: this guidance qualifies how the model
 * uses the memory tools, so it sits immediately after the digest it explains.
 */
export const SELF_IMPROVE_SECTION_ORDER = -49

/**
 * Mount the self-improvement guidance section.
 * @param ctx - Cordis context carrying the system-prompt registry.
 * @param config - Validated guidance config.
 */
export function apply(ctx: Context, config: Config): void {
  const section: PromptSection = {
    name: 'self-improvement',
    order: SELF_IMPROVE_SECTION_ORDER,
    text: () => getPromptSection(config),
  }
  ctx.effect(() => ctx.systemPrompt.section(section), 'self-improve-prompt.section')
}
