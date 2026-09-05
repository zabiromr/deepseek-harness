/**
 * The decay policy: the plugin that actually runs reclassification, so a
 * lesson nothing re-confirms fades on a schedule instead of only when someone
 * happens to call the service.
 * @module @deepseek-ai/dsh-memory-decay
 */

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { ReclassifySummary } from '@deepseek-ai/dsh-memory'

/** Cordis plugin name. */
export const name = 'memory-decay'
/** Services required before the policy can mount. */
export const inject = ['memory']

/**
 * Plugin config. The sweep interval is a deployment choice: it trades how
 * promptly a faded lesson leaves the digest against how often a long-running
 * host wakes to do arithmetic over the whole store.
 */
export interface Config {
  /** Milliseconds between reclassification sweeps. */
  sweepIntervalMs: number
  /** Whether to sweep once at mount, before the first interval elapses. */
  sweepOnStart: boolean
}

export const Config: s<Config> = s.object({
  sweepIntervalMs: s.natural().min(1).required(),
  sweepOnStart: s.boolean().required(),
})

/**
 * Mount the decay sweep.
 *
 * The policy owns WHEN reclassification runs and nothing else: the arithmetic,
 * the half-life, and the floors all belong to the memory service, so the digest
 * can never rank by parameters the sweep does not apply.
 * @param ctx - Cordis context carrying the memory service and the timer effect.
 * @param config - Validated sweep config.
 */
export function apply(ctx: Context, config: Config): void {
  const sweep = async (): Promise<ReclassifySummary | undefined> => {
    try {
      return await ctx.memory.reclassify(Date.now())
    } catch (error) {
      // A failed sweep must not tear down the host: decay is a maintenance
      // pass, and the next interval retries against the same records.
      ctx.logger.warn(`memory-decay: sweep failed: ${describe(error)}`)
      return undefined
    }
  }

  const timer = setInterval(() => { void sweep() }, config.sweepIntervalMs)
  // Never hold the process open for a maintenance sweep.
  timer.unref()
  ctx.effect(() => () => { clearInterval(timer) }, 'memory-decay.sweepTimer')

  if (config.sweepOnStart) void sweep()
}

/**
 * Describe a thrown value for one log line.
 * @param error - The rejected value.
 * @returns its message, or its string form when it is not an Error.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
