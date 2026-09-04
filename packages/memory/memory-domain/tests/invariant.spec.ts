/**
 * The provider's invariant companion: it reserves the package name, and it
 * polices the relation this package actually owns — that every lesson written
 * to the durable medium carries at least one evidence citation.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { MEMORY_DOMAIN_NAME } from '@deepseek-ai/dsh-memory'
import * as MemoryDomainInvariant from '../src/invariant.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/**
 * Mount the registry and the companion on a fresh context.
 * @returns the mounted context.
 */
async function mount(): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(MemoryDomainInvariant)
  return ctx
}

/**
 * Emit one durable change against the memory domain.
 * @param ctx - The mounted context.
 * @param change - Fields overriding a well-formed lesson put.
 */
function emitChange(ctx: Context, change: Record<string, unknown>): void {
  ctx.emit('domain/changed', {
    domain: MEMORY_DOMAIN_NAME,
    table: 'lessons',
    key: 'lesson-1',
    operation: 'put',
    value: { evidence: [{ session: 's1', seq: [1] }] },
    ...change,
  })
}

describe('memory-domain invariant companion', () => {
  it('removes its registry contribution when its fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(MemoryDomainInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-memory-domain', () => {})
    }).toThrow(/already registered/u)

    await fiber.dispose()
    await expect(ctx.plugin(MemoryDomainInvariant).await()).resolves.toBeDefined()
  })

  it('accepts a lesson written with citations', async () => {
    const ctx = await mount()
    expect(() => { emitChange(ctx, {}) }).not.toThrow()
  })

  it('rejects a lesson written to the medium with no citation', async () => {
    const ctx = await mount()
    expect(() => { emitChange(ctx, { value: { evidence: [] } }) }).toThrow(/no evidence citation/u)
  })

  it('rejects a written record that carries no evidence field at all', async () => {
    const ctx = await mount()
    expect(() => { emitChange(ctx, { value: { title: 'orphan' } }) }).toThrow(/no evidence citation/u)
  })

  it('rejects a non-object snapshot', async () => {
    const ctx = await mount()
    expect(() => { emitChange(ctx, { value: null }) }).toThrow(/no evidence citation/u)
  })

  it('ignores writes belonging to another domain', async () => {
    const ctx = await mount()
    expect(() => { emitChange(ctx, { domain: 'other', value: { evidence: [] } }) }).not.toThrow()
  })

  it('ignores deletes, which carry no snapshot to check', async () => {
    const ctx = await mount()
    expect(() => { emitChange(ctx, { operation: 'deleted', value: undefined }) }).not.toThrow()
  })
})
