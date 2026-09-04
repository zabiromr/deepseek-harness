/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-memory-decay`.
 * @module @deepseek-ai/dsh-memory-decay/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-decay'

/** Cordis companion plugin name. */
export const name = 'memory-decay-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns only WHEN reclassification runs. It
 * holds no records, appends no session events, and its one timer is released
 * by a `ctx.effect` disposer whose survival the host's own teardown checks
 * already cover. The lesson records it moves belong to the memory provider's
 * companion. The reservation still claims the package name so a later durable
 * rule has a home.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
