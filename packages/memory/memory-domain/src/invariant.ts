/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-memory-domain`.
 * @module @deepseek-ai/dsh-memory-domain/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { MEMORY_DOMAIN_NAME } from '@deepseek-ai/dsh-memory'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-domain'

/** Cordis companion plugin name. */
export const name = 'memory-domain-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Whether a durably written record carries at least one citation.
 * @param value - The new snapshot from a `put`.
 * @returns whether the snapshot has a non-empty `evidence` array.
 */
function hasEvidence(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const { evidence } = value as { evidence?: unknown }
  return Array.isArray(evidence) && evidence.length > 0
}

/**
 * Owned relation: every lesson this package writes to the `memory` domain
 * carries at least one evidence citation. The evidence rule is what makes a
 * stored lesson auditable and therefore safe to re-inject into a later prompt,
 * and it is enforced at the service boundary — but the boundary is only one of
 * the paths that can reach the table. Watching the durable write stream checks
 * the relation where it actually matters: on the medium, after durability.
 *
 * Deletes carry no snapshot and are ignored; the service never deletes a
 * lesson, and a foreign delete cannot produce an uncited record.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change: DomainChanged) => {
    if (change.domain !== MEMORY_DOMAIN_NAME) return
    if (change.operation !== 'put') return
    if (hasEvidence(change.value)) return
    fail(`memory-domain wrote lesson '${change.key}' with no evidence citation`)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
