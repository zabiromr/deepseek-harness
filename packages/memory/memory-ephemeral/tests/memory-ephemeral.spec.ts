/**
 * The in-process provider: the service contract every memory provider must
 * honour, exercised without a durable medium.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type { LessonId, RecordLessonRequest } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session'
import EphemeralMemoryService from '../src/index.ts'

const DAY = 24 * 60 * 60 * 1000
const CONFIG = { halfLifeMs: 30 * DAY, dormantFloor: 0.25, retireFloor: 0.05 }

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/**
 * Mount the provider on a fresh context.
 * @param config - Decay policy override.
 * @returns the mounted service.
 */
async function mount(config = CONFIG): Promise<EphemeralMemoryService> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(EphemeralMemoryService, config)
  return ctx.memory as EphemeralMemoryService
}

function request(overrides: Partial<RecordLessonRequest> = {}): RecordLessonRequest {
  return {
    scope: '/repo',
    title: 'Run the formatter',
    body: 'The repository formatter rejects tabs.',
    evidence: [{ session: 's1' as SessionId, seq: [3] }],
    ...overrides,
  }
}

describe('mounting', () => {
  it('registers itself as ctx.memory', async () => {
    const memory = await mount()
    expect(memory).toBeInstanceOf(EphemeralMemoryService)
  })

  it('exposes the configured decay parameters as the one home of the policy', async () => {
    const memory = await mount()
    expect(memory.decay).toEqual(CONFIG)
  })

  it('refuses a retire floor above the dormant floor, which would make dormant unreachable', async () => {
    await expect(mount({ halfLifeMs: DAY, dormantFloor: 0.1, retireFloor: 0.9 }))
      .rejects.toThrow(MemoryError)
  })
})

describe('record', () => {
  it('stores a cited lesson and returns it active', async () => {
    const memory = await mount()
    const lesson = await memory.record(request())
    expect(lesson.status).toBe('active')
    expect(await memory.get(lesson.id)).toEqual(lesson)
  })

  it('rejects an uncited lesson before storing anything', async () => {
    const memory = await mount()
    await expect(memory.record(request({ evidence: [] }))).rejects.toThrow(MemoryError)
    expect(await memory.recall({ limit: 10 })).toHaveLength(0)
  })
})

describe('confirm and contradict', () => {
  it('raises standing on confirmation', async () => {
    const memory = await mount()
    const lesson = await memory.record(request())
    const confirmed = await memory.confirm(lesson.id, [{ session: 's2' as SessionId, seq: [1] }])
    expect(confirmed.confirmations).toBe(1)
    expect(confirmed.evidence).toHaveLength(2)
  })

  it('retires a lesson on contradiction', async () => {
    const memory = await mount()
    const lesson = await memory.record(request())
    const argued = await memory.contradict(lesson.id, [{ session: 's2' as SessionId, seq: [1] }])
    expect(argued.status).toBe('retired')
  })

  it('rejects a restatement of an unknown lesson', async () => {
    const memory = await mount()
    await expect(memory.confirm('absent' as LessonId, [{ session: 's2' as SessionId, seq: [1] }]))
      .rejects.toThrow(MemoryError)
  })

  it('rejects an uncited restatement', async () => {
    const memory = await mount()
    const lesson = await memory.record(request())
    await expect(memory.confirm(lesson.id, [])).rejects.toThrow(MemoryError)
  })

  it('persists the restatement, so a later read sees the new standing', async () => {
    const memory = await mount()
    const lesson = await memory.record(request())
    await memory.confirm(lesson.id, [{ session: 's2' as SessionId, seq: [1] }])
    expect((await memory.get(lesson.id))?.confirmations).toBe(1)
  })
})

describe('recall and digest', () => {
  it('finds a stored lesson by text', async () => {
    const memory = await mount()
    await memory.record(request())
    expect(await memory.recall({ limit: 10, text: 'formatter' })).toHaveLength(1)
  })

  it('rejects a non-positive recall limit', async () => {
    const memory = await mount()
    await expect(memory.recall({ limit: 0 })).rejects.toThrow(MemoryError)
  })

  it('carries an active lesson into the digest for its workspace', async () => {
    const memory = await mount()
    await memory.record(request())
    expect(await memory.digest({ scope: '/repo', maxLessons: 5 })).toHaveLength(1)
  })

  it('keeps a lesson out of a sibling workspace digest', async () => {
    const memory = await mount()
    await memory.record(request())
    expect(await memory.digest({ scope: '/other', maxLessons: 5 })).toHaveLength(0)
  })

  it('rejects a non-positive digest cap', async () => {
    const memory = await mount()
    await expect(memory.digest({ scope: '/repo', maxLessons: 0 })).rejects.toThrow(MemoryError)
  })

  it('reports nothing for an unknown id', async () => {
    const memory = await mount()
    expect(await memory.get('absent' as LessonId)).toBeUndefined()
  })
})

describe('reclassify', () => {
  it('demotes a lesson nothing re-confirmed and leaves it recallable', async () => {
    const memory = await mount()
    const lesson = await memory.record(request())
    const summary = await memory.reclassify(Date.now() + 60 * DAY)
    expect(summary.demoted).toBe(1)
    expect((await memory.get(lesson.id))?.status).toBe('dormant')
    expect(await memory.recall({ limit: 10 })).toHaveLength(1)
  })

  it('retires a lesson left uncited long enough', async () => {
    const memory = await mount()
    await memory.record(request())
    expect((await memory.reclassify(Date.now() + 300 * DAY)).retired).toBe(1)
  })

  it('counts an unchanged lesson rather than rewriting it', async () => {
    const memory = await mount()
    await memory.record(request())
    expect(await memory.reclassify(Date.now())).toEqual({ demoted: 0, retired: 0, unchanged: 1 })
  })
})
