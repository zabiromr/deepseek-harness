/**
 * The invariant companion reserves this package's name and releases it on
 * disposal, so a reload cannot leave the registry holding a dead claim.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as BraveInvariant from '../src/invariant.ts'

describe('@deepseek-ai/dsh-web-search-brave invariant companion', () => {
  it('removes its registry contribution when its fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      const fiber = await ctx.plugin(BraveInvariant)

      expect(() => {
        ctx.invariants.register('@deepseek-ai/dsh-web-search-brave', () => {})
      }).toThrow(/already registered/u)

      await fiber.dispose()
      await expect(ctx.plugin(BraveInvariant).await()).resolves.toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
