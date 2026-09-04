/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-knowledge-base`.
 * @module @deepseek-ai/dsh-tool-knowledge-base/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-knowledge-base'

/** Cordis companion plugin name. */
export const name = 'tool-knowledge-base-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package contributes one tool registration and
 * appends no package-owned session events, so the knowledge store carry no durable
 * shape this companion could police. The reservation still claims the
 * package name so a later durable rule has a home.
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
