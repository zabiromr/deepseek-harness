/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-file-browser`.
 * @module @deepseek-ai/dsh-client-ui-file-browser/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-file-browser'

/** Cordis companion plugin name. */
export const name = 'client-ui-file-browser-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser is a presentation surface that reads and
 * writes files through the session Remote. It appends no package-owned session
 * events and holds no cross-plugin mutable state, so there is no durable shape
 * to police — the reservation claims the package name for a later rule.
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
