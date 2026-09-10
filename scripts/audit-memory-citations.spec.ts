/**
 * Drives the audit over a scratch DSH home holding real session logs written
 * by the JSONL backend's own encoder, so the frame container and the packed
 * chunk rows are exercised rather than assumed: a reader that stops at the
 * first frame, or that counts a packed row as one event, reports sequence
 * numbers absent that are present.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compressZstdFrame } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import { packChunkRuns } from '@deepseek-ai/dsh-session/chunk-rows'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { auditCitations } from './audit-memory-citations.ts'

const PROJECT = '--scratch--'
const SESSION = 'session-audit-1'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Build one event of a given type at one sequence number.
 * @param seq - sequence number.
 * @param type - event type.
 * @returns an event the codec accepts.
 */
function event(seq: number, type: string): SessionEvent {
  return { seq, time: 0, type, data: {} } as unknown as SessionEvent
}

/**
 * Lay out a scratch home: one session log in two frames, one lesson file.
 * @param evidence - citations to store on the lesson.
 * @param events - events the session log carries.
 * @returns the home directory.
 */
async function scratchHome(
  evidence: { session: string; seq: number[] }[],
  events: SessionEvent[],
): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-audit-'))
  roots.push(home)

  const dir = join(home, 'sessions', PROJECT, SESSION)
  mkdirSync(dir, { recursive: true })
  const lines = packChunkRuns(events).map(record => `${JSON.stringify(record)}\n`)
  const half = Math.max(1, Math.floor(lines.length / 2))
  // Two frames: a single-frame reader would see only the first half.
  writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([
    await compressZstdFrame(Buffer.from(lines.slice(0, half).join(''), 'utf8')),
    await compressZstdFrame(Buffer.from(lines.slice(half).join(''), 'utf8')),
  ]))

  const lessons = join(home, 'storages', 'memory', 'lessons')
  mkdirSync(lessons, { recursive: true })
  writeFileSync(join(lessons, 'a.json'), JSON.stringify({
    version: 1,
    record: { id: 'a', title: 'A lesson', status: 'active', evidence },
  }))
  return home
}

describe('citation audit', () => {
  it('counts the work events a citation names', async () => {
    const home = await scratchHome(
      [{ session: SESSION, seq: [0, 2, 3] }],
      [event(0, 'turn/start'), event(1, 'step/start'), event(2, 'tool/call'), event(3, 'tool/result')],
    )
    const [finding] = auditCitations(home)
    expect(finding).toMatchObject({ cited: 3, work: 2, unresolved: 0, blanket: false })
  })

  it('reports a citation naming no work, which every stored rule still allows', async () => {
    const home = await scratchHome(
      [{ session: SESSION, seq: [0, 1] }],
      [event(0, 'turn/start'), event(1, 'step/start'), event(2, 'tool/call')],
    )
    expect(auditCitations(home)[0]).toMatchObject({ work: 0, unresolved: 0 })
  })

  it('reports a citation into a session it cannot read', async () => {
    const home = await scratchHome([{ session: 'session-absent', seq: [0, 1] }], [event(0, 'turn/start')])
    expect(auditCitations(home)[0]).toMatchObject({ cited: 2, unresolved: 2 })
  })

  // The rules the capture tool enforces cannot see the difference between
  // choosing three events and naming every event in the session; this can.
  it('flags an evenly spaced sweep and spares a precise citation of the same width', async () => {
    const events = Array.from({ length: 40 }, (_, seq) => event(seq, seq % 4 === 0 ? 'tool/call' : 'step/start'))
    const sweep = await scratchHome([{ session: SESSION, seq: Array.from({ length: 10 }, (_, i) => i) }], events)
    expect(auditCitations(sweep)[0]?.blanket).toBe(true)

    const strided = await scratchHome([{ session: SESSION, seq: [0, 4, 8, 12, 16, 20, 24, 28] }], events)
    expect(auditCitations(strided)[0]?.blanket).toBe(true)

    const precise = await scratchHome([{ session: SESSION, seq: [0, 1, 4, 5, 12, 13, 24, 30] }], events)
    expect(auditCitations(precise)[0]?.blanket).toBe(false)
  })

  it('reads across frames and expands packed chunk runs', async () => {
    // A run of same-block deltas packs into one storage row; the audit must
    // still resolve each original sequence number behind it.
    const events: SessionEvent[] = [
      event(0, 'tool/call'),
      ...Array.from({ length: 6 }, (_, i) => ({
        seq: i + 1,
        time: 0,
        type: 'assistant/chunk',
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: `t${i}` } },
      }) as unknown as SessionEvent),
      event(7, 'tool/result'),
    ]
    const home = await scratchHome([{ session: SESSION, seq: [0, 3, 7] }], events)
    expect(auditCitations(home)[0]).toMatchObject({ cited: 3, unresolved: 0, work: 2 })
  })

  it('returns nothing for a home with no store', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-audit-empty-'))
    roots.push(home)
    expect(auditCitations(home)).toEqual([])
  })
})
