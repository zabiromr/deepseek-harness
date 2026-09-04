/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-memory-prompt`.
 * @module @deepseek-ai/dsh-memory-prompt/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-prompt'

/** Cordis companion plugin name. */
export const name = 'memory-prompt-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package contributes one prompt section over a
 * cached snapshot and appends no session events. Its budget rule is a pure
 * function of the rendered text, checked by unit tests rather than by watching
 * a mutable relationship, and the lesson records it reads belong to the memory
 * provider's companion. The reservation still claims the package name so a
 * later durable rule has a home.
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
