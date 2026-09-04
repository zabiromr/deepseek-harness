/**
 * The decay sweep: when reclassification runs, and what a failing sweep does.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EphemeralMemory from '@deepseek-ai/dsh-memory-ephemeral'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as MemoryDecay from '../src/index.ts'

const DAY = 24 * 60 * 60 * 1000
const MEMORY = { halfLifeMs: 30 * DAY, dormantFloor: 0.25, retireFloor: 0.05 }

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * Mount the sweep over an in-process memory store.
 * @param config - Sweep policy.
 * @returns the mounted context.
 */
async function mount(config: MemoryDecay.Config): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(EphemeralMemory, MEMORY)
  await ctx.plugin(MemoryDecay, config)
  return ctx
}

describe('the decay sweep', () => {
  it('sweeps once at mount when asked', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(EphemeralMemory, MEMORY)
    const reclassify = vi.spyOn(ctx.memory, 'reclassify')
    await ctx.plugin(MemoryDecay, { sweepIntervalMs: 60_000, sweepOnStart: true })
    await vi.waitFor(() => {
      expect(reclassify).toHaveBeenCalled()
    })
  })

  it('does not sweep at mount when the deployment opts out', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(EphemeralMemory, MEMORY)
    const reclassify = vi.spyOn(ctx.memory, 'reclassify')
    await ctx.plugin(MemoryDecay, { sweepIntervalMs: 60_000, sweepOnStart: false })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(reclassify).not.toHaveBeenCalled()
  })

  it('sweeps again on each interval', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    context = ctx
    await ctx.plugin(EphemeralMemory, MEMORY)
    const reclassify = vi.spyOn(ctx.memory, 'reclassify')
    await ctx.plugin(MemoryDecay, { sweepIntervalMs: 1_000, sweepOnStart: false })
    await vi.advanceTimersByTimeAsync(3_500)
    expect(reclassify).toHaveBeenCalledTimes(3)
  })

  it('actually fades a lesson nothing re-confirmed', async () => {
    const ctx = await mount({ sweepIntervalMs: 60_000, sweepOnStart: false })
    const lesson = await ctx.memory.record({
      scope: '/repo',
      title: 'Run the formatter',
      body: 'The repository formatter rejects tabs.',
      evidence: [{ session: 's1' as SessionId, seq: [3] }],
    })
    await ctx.memory.reclassify(Date.now() + 300 * DAY)
    expect((await ctx.memory.get(lesson.id))?.status).toBe('retired')
  })

  it('survives a failing sweep and keeps the host running', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(EphemeralMemory, MEMORY)
    vi.spyOn(ctx.memory, 'reclassify').mockRejectedValue(new Error('store gone'))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(MemoryDecay, { sweepIntervalMs: 60_000, sweepOnStart: true })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('store gone'))
    })
  })

  it('reports a non-Error rejection without crashing the sweep', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(EphemeralMemory, MEMORY)
    vi.spyOn(ctx.memory, 'reclassify').mockRejectedValue('plain string')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(MemoryDecay, { sweepIntervalMs: 60_000, sweepOnStart: true })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('plain string'))
    })
  })

  it('stops sweeping once its fiber is disposed', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    context = ctx
    await ctx.plugin(EphemeralMemory, MEMORY)
    const reclassify = vi.spyOn(ctx.memory, 'reclassify')
    const fiber = await ctx.plugin(MemoryDecay, { sweepIntervalMs: 1_000, sweepOnStart: false })
    await fiber.dispose()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(reclassify).not.toHaveBeenCalled()
  })
})
