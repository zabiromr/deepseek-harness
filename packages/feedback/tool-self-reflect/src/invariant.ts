/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-self-reflect`.
 * @module @deepseek-ai/dsh-tool-self-reflect/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-self-reflect'

/** Cordis companion plugin name. */
export const name = 'tool-self-reflect-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package contributes one tool registration and
 * appends no package-owned session events, so retrospective prompts carry no durable
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
