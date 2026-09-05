/**
 * The mounted digest section: what a later assembly carries, and how the
 * section behaves when the memory store cannot be read.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import EphemeralMemory from '@deepseek-ai/dsh-memory-ephemeral'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as MemoryPrompt from '../src/index.ts'

const DAY = 24 * 60 * 60 * 1000
const MEMORY = { halfLifeMs: 30 * DAY, dormantFloor: 0.25, retireFloor: 0.05 }
const BUDGET = { maxLessons: 5, maxChars: 2000 }

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.restoreAllMocks()
})

/**
 * Mount the prompt section over an in-process memory store.
 * @returns the mounted context.
 */
async function mount(): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(EphemeralMemory, MEMORY)
  await ctx.plugin(MemoryPrompt, BUDGET)
  return ctx
}

/**
 * Read the digest section from one assembly.
 * @param ctx - The mounted context.
 * @returns the section text, or undefined when the section contributed nothing.
 */
async function digestText(ctx: Context): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble()
  return assembly.sections.find(section => section.name === 'memory-digest')?.text
}

describe('the mounted digest', () => {
  it('contributes nothing when no lesson has been recorded', async () => {
    const ctx = await mount()
    expect(await digestText(ctx)).toBeFalsy()
  })

  it('carries a lesson recorded for the running workspace into a later assembly', async () => {
    const ctx = await mount()
    await ctx.memory.record({
      scope: process.cwd(),
      title: 'Run the formatter',
      body: 'The repository formatter rejects tabs.',
      evidence: [{ session: 's1' as SessionId, seq: [3] }],
    })
    // The section serves a cached snapshot; the first assembly schedules the
    // refresh that the next one reads.
    await digestText(ctx)
    await vi.waitFor(async () => {
      expect(await digestText(ctx)).toContain('Run the formatter')
    })
  })

  it('leaves out a lesson belonging to another workspace', async () => {
    const ctx = await mount()
    await ctx.memory.record({
      scope: '/some/other/workspace',
      title: 'Foreign lesson',
      body: 'Belongs elsewhere.',
      evidence: [{ session: 's1' as SessionId, seq: [3] }],
    })
    await digestText(ctx)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await digestText(ctx) ?? '').not.toContain('Foreign lesson')
  })

  it('degrades to an empty section when the store cannot be read, rather than failing assembly', async () => {
    const ctx = await mount()
    vi.spyOn(ctx.memory, 'digest').mockRejectedValue(new Error('store gone'))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await digestText(ctx)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled()
    })
    expect(await digestText(ctx)).toBeFalsy()
  })

  it('removes its section when the plugin is disposed', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(EphemeralMemory, MEMORY)
    const fiber = await ctx.plugin(MemoryPrompt, BUDGET)
    await fiber.dispose()
    await expect(ctx.plugin(MemoryPrompt, BUDGET).await()).resolves.toBeDefined()
  })
})

describe('refresh behaviour', () => {
  it('shares one in-flight refresh between concurrent assemblies', async () => {
    const ctx = await mount()
    const digest = vi.spyOn(ctx.memory, 'digest')
    await Promise.all([digestText(ctx), digestText(ctx), digestText(ctx)])
    expect(digest.mock.calls.length).toBeLessThan(3)
  })

  it('reports a non-Error rejection without crashing assembly', async () => {
    const ctx = await mount()
    vi.spyOn(ctx.memory, 'digest').mockRejectedValue('plain string')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await digestText(ctx)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('plain string'))
    })
  })
})
