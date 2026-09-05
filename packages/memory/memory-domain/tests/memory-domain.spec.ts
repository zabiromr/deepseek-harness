/**
 * The durable provider: lessons survive a remount, and the service contract
 * behaves identically over a real medium.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type { LessonId } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import DomainMemoryService from '../src/index.ts'
import { CONFIG, request, setupHarness } from './helpers.ts'
import type { DurableHarness } from './helpers.ts'

const DAY = 24 * 60 * 60 * 1000

let harness: DurableHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

describe('durable capture', () => {
  it('stores a cited lesson', async () => {
    harness = await setupHarness()
    const lesson = await harness.memory.record(request())
    expect(await harness.memory.get(lesson.id)).toEqual(lesson)
  })

  it('rejects an uncited lesson without writing', async () => {
    harness = await setupHarness()
    await expect(harness.memory.record(request({ evidence: [] }))).rejects.toThrow(MemoryError)
    expect(await harness.memory.recall({ limit: 10 })).toHaveLength(0)
  })

  it('refuses a retire floor above the dormant floor', async () => {
    await expect(setupHarness({ halfLifeMs: DAY, dormantFloor: 0.1, retireFloor: 0.9 }))
      .rejects.toThrow(MemoryError)
  })
})

describe('durability across a remount', () => {
  it('serves a lesson recorded by an earlier host', async () => {
    harness = await setupHarness()
    const lesson = await harness.memory.record(request())
    const root = harness.root
    await harness.ctx.fiber.dispose()

    const ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(DomainMemoryService, CONFIG)
    try {
      const digest = await ctx.memory.digest({ scope: '/repo', maxLessons: 5 })
      expect(digest.map(item => item.id)).toEqual([lesson.id])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('durable restatement', () => {
  it('records a confirmation durably', async () => {
    harness = await setupHarness()
    const lesson = await harness.memory.record(request())
    await harness.memory.confirm(lesson.id, [{ session: 's2' as SessionId, seq: [1] }])
    expect((await harness.memory.get(lesson.id))?.confirmations).toBe(1)
  })

  it('retires a contradicted lesson durably', async () => {
    harness = await setupHarness()
    const lesson = await harness.memory.record(request())
    await harness.memory.contradict(lesson.id, [{ session: 's2' as SessionId, seq: [1] }])
    expect((await harness.memory.get(lesson.id))?.status).toBe('retired')
  })

  it('rejects a restatement of an unknown lesson', async () => {
    harness = await setupHarness()
    await expect(harness.memory.confirm('absent' as LessonId, [{ session: 's2' as SessionId, seq: [1] }]))
      .rejects.toThrow(MemoryError)
  })

  it('rejects an uncited restatement', async () => {
    harness = await setupHarness()
    const lesson = await harness.memory.record(request())
    await expect(harness.memory.confirm(lesson.id, [])).rejects.toThrow(MemoryError)
  })
})

describe('durable selection', () => {
  it('finds a lesson by text', async () => {
    harness = await setupHarness()
    await harness.memory.record(request())
    expect(await harness.memory.recall({ limit: 10, text: 'formatter' })).toHaveLength(1)
  })

  it('rejects a non-positive recall limit', async () => {
    harness = await setupHarness()
    await expect(harness.memory.recall({ limit: 0 })).rejects.toThrow(MemoryError)
  })

  it('rejects a non-positive digest cap', async () => {
    harness = await setupHarness()
    await expect(harness.memory.digest({ scope: '/repo', maxLessons: 0 })).rejects.toThrow(MemoryError)
  })

  it('reports nothing for an unknown id', async () => {
    harness = await setupHarness()
    expect(await harness.memory.get('absent' as LessonId)).toBeUndefined()
  })
})

describe('durable reclassification', () => {
  it('demotes an unconfirmed lesson and keeps it recallable', async () => {
    harness = await setupHarness()
    const lesson = await harness.memory.record(request())
    expect((await harness.memory.reclassify(Date.now() + 60 * DAY)).demoted).toBe(1)
    expect((await harness.memory.get(lesson.id))?.status).toBe('dormant')
    expect(await harness.memory.recall({ limit: 10 })).toHaveLength(1)
  })

  it('retires a long-uncited lesson', async () => {
    harness = await setupHarness()
    await harness.memory.record(request())
    expect((await harness.memory.reclassify(Date.now() + 300 * DAY)).retired).toBe(1)
  })

  it('leaves a current lesson untouched', async () => {
    harness = await setupHarness()
    await harness.memory.record(request())
    expect(await harness.memory.reclassify(Date.now())).toEqual({ demoted: 0, retired: 0, unchanged: 1 })
  })
})

describe('a service whose domain never opened', () => {
  it('reports the store as unavailable rather than reading a missing table', async () => {
    const ctx = new Context()
    try {
      const service = new DomainMemoryService(ctx, CONFIG)
      await expect(service.recall({ limit: 1 })).rejects.toThrow(MemoryError)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
