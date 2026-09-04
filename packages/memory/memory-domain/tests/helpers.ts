/**
 * Durable test harness: the memory provider over a real storage-domain on a
 * temporary JSON medium.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { RecordLessonRequest } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session'
import DomainMemoryService from '../src/index.ts'

const DAY = 24 * 60 * 60 * 1000

/** Decay policy shared by the durable suites. */
export const CONFIG = { halfLifeMs: 30 * DAY, dormantFloor: 0.25, retireFloor: 0.05 }

/** One mounted harness plus its temporary medium. */
export interface DurableHarness {
  readonly ctx: Context
  readonly memory: DomainMemoryService
  readonly root: string
  dispose(): Promise<void>
}

/**
 * Mount storage, the domain form, and the memory provider on a fresh context.
 * @param config - Decay policy override.
 * @returns the mounted harness.
 */
export async function setupHarness(config = CONFIG): Promise<DurableHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-domain-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(DomainMemoryService, config)
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    ctx,
    memory: ctx.memory as DomainMemoryService,
    root,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * Build a valid capture request.
 * @param overrides - Fields to replace.
 * @returns the request.
 */
export function request(overrides: Partial<RecordLessonRequest> = {}): RecordLessonRequest {
  return {
    scope: '/repo',
    title: 'Run the formatter',
    body: 'The repository formatter rejects tabs.',
    evidence: [{ session: 's1' as SessionId, seq: [3] }],
    ...overrides,
  }
}
