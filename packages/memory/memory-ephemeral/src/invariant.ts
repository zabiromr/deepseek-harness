/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-memory-ephemeral`.
 * @module @deepseek-ai/dsh-memory-ephemeral/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-ephemeral'

/** Cordis companion plugin name. */
export const name = 'memory-ephemeral-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this provider's records live in one Map owned by the
 * service instance and die with it, so there is no durable relationship to
 * police — the evidence rule this store upholds is enforced by the seam's
 * shared validation, whose failures are ordinary rejections rather than a
 * silent bad write. The durable provider, whose medium CAN outlive a bad write,
 * carries that check instead. The reservation still claims the package name so
 * a later durable rule has a home.
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
