/**
 * The medium-independent store logic: how a captured lesson is shaped, what a
 * confirmation and a contradiction each do, and which lessons a recall query or
 * a digest selects.
 */

import { describe, expect, it } from 'vitest'
import {
  buildLesson,
  copyEvidence,
  inScope,
  matchesText,
  nextStatus,
  rankLessons,
  restateLesson,
  selectDigest,
  selectRecall,
} from '../src/store.ts'
import { GLOBAL_SCOPE } from '../src/types.ts'
import type { DecayParams, Lesson, LessonId, RecordLessonRequest } from '../src/types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

const DAY = 24 * 60 * 60 * 1000
const DECAY: DecayParams = { halfLifeMs: 30 * DAY, dormantFloor: 0.25, retireFloor: 0.05 }

function citation(seq: readonly number[], session = 's1'): { session: SessionId; seq: readonly number[] } {
  return { session: session as SessionId, seq }
}

function request(overrides: Partial<RecordLessonRequest> = {}): RecordLessonRequest {
  return {
    scope: '/repo',
    title: 'Run the formatter',
    body: 'The repository formatter rejects tabs.',
    evidence: [citation([3])],
    ...overrides,
  }
}

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return { ...buildLesson(request(), 0), id: 'a' as LessonId, ...overrides }
}

describe('buildLesson', () => {
  it('starts a captured lesson active, uncounted, and with its clock at capture', () => {
    const built = buildLesson(request(), 1_000)
    expect(built.status).toBe('active')
    expect(built.confirmations).toBe(0)
    expect(built.contradictions).toBe(0)
    expect(built.createdAt).toBe(1_000)
    expect(built.lastConfirmedAt).toBe(1_000)
  })

  it('defaults absent tags to an empty list', () => {
    expect(buildLesson(request(), 0).tags).toEqual([])
  })

  it('keeps supplied tags', () => {
    expect(buildLesson(request({ tags: ['build'] }), 0).tags).toEqual(['build'])
  })

  it('mints a distinct id per capture', () => {
    expect(buildLesson(request(), 0).id).not.toBe(buildLesson(request(), 0).id)
  })

  it('copies the caller\'s citations so a later mutation cannot rewrite the record', () => {
    const seq = [1, 2]
    const built = buildLesson(request({ evidence: [citation(seq)] }), 0)
    seq.push(3)
    expect(built.evidence[0]?.seq).toEqual([1, 2])
  })
})

describe('copyEvidence', () => {
  it('returns an equal citation that does not alias its source', () => {
    const source = citation([1, 2])
    const copy = copyEvidence(source)
    expect(copy).toEqual(source)
    expect(copy.seq).not.toBe(source.seq)
  })
})

describe('restateLesson', () => {
  it('raises confirmations and resets the decay clock', () => {
    const confirmed = restateLesson(lesson(), [citation([9])], 'confirm', 10 * DAY, DECAY)
    expect(confirmed.confirmations).toBe(1)
    expect(confirmed.lastConfirmedAt).toBe(10 * DAY)
  })

  it('raises contradictions without resetting the clock, so arguing cannot freshen a stale lesson', () => {
    const argued = restateLesson(lesson(), [citation([9])], 'contradict', 10 * DAY, DECAY)
    expect(argued.contradictions).toBe(1)
    expect(argued.lastConfirmedAt).toBe(0)
  })

  it('appends the new citations to the existing ones', () => {
    const restated = restateLesson(lesson(), [citation([9])], 'confirm', 0, DECAY)
    expect(restated.evidence).toHaveLength(2)
    expect(restated.evidence[1]?.seq).toEqual([9])
  })

  it('retires a lesson the moment it is contradicted', () => {
    expect(restateLesson(lesson(), [citation([9])], 'contradict', 0, DECAY).status).toBe('retired')
  })

  it('revives a faded lesson that new evidence confirms', () => {
    const faded = lesson({ status: 'dormant', lastConfirmedAt: 0 })
    expect(restateLesson(faded, [citation([9])], 'confirm', 90 * DAY, DECAY).status).toBe('active')
  })
})

describe('inScope', () => {
  it('admits a lesson from the same workspace', () => {
    expect(inScope(lesson({ scope: '/repo' }), '/repo')).toBe(true)
  })

  it('admits a globally-scoped lesson in every workspace', () => {
    expect(inScope(lesson({ scope: GLOBAL_SCOPE }), '/elsewhere')).toBe(true)
  })

  it('excludes a lesson belonging to a sibling workspace', () => {
    expect(inScope(lesson({ scope: '/other' }), '/repo')).toBe(false)
  })
})

describe('matchesText', () => {
  it('matches the title case-insensitively', () => {
    expect(matchesText(lesson({ title: 'Run the Formatter' }), 'formatter')).toBe(true)
  })

  it('matches the body', () => {
    expect(matchesText(lesson({ body: 'tabs are rejected' }), 'tabs')).toBe(true)
  })

  it('matches a tag', () => {
    expect(matchesText(lesson({ tags: ['build'] }), 'buil')).toBe(true)
  })

  it('reports no match when nothing contains the needle', () => {
    expect(matchesText(lesson({ title: 'a', body: 'b', tags: [] }), 'zzz')).toBe(false)
  })
})

describe('rankLessons', () => {
  it('orders by decayed score and applies the cap', () => {
    const strong = lesson({ id: 'strong' as LessonId, confirmations: 3 })
    const weak = lesson({ id: 'weak' as LessonId })
    expect(rankLessons([weak, strong], 0, DECAY, 1).map(item => item.id)).toEqual(['strong'])
  })
})

describe('selectRecall', () => {
  const active = lesson({ id: 'active' as LessonId, tags: ['build'], title: 'formatter' })
  const retired = lesson({ id: 'retired' as LessonId, status: 'retired', title: 'formatter' })
  const foreign = lesson({ id: 'foreign' as LessonId, scope: '/other', title: 'formatter' })
  const all = [active, retired, foreign]

  it('searches every status by default, so a faded lesson stays findable', () => {
    const found = selectRecall(all, { limit: 10 }, 0, DECAY).map(item => item.id)
    expect(found).toContain('retired')
  })

  it('honours an explicit status filter', () => {
    const found = selectRecall(all, { limit: 10, statuses: ['active'] }, 0, DECAY).map(item => item.id)
    expect(found).not.toContain('retired')
  })

  it('pins results to one workspace plus the global scope when a scope is given', () => {
    const found = selectRecall(all, { limit: 10, scope: '/repo' }, 0, DECAY).map(item => item.id)
    expect(found).not.toContain('foreign')
  })

  it('requires every listed tag', () => {
    const found = selectRecall(all, { limit: 10, tags: ['build', 'absent'] }, 0, DECAY)
    expect(found).toHaveLength(0)
  })

  it('filters by text', () => {
    expect(selectRecall(all, { limit: 10, text: 'nothing-matches' }, 0, DECAY)).toHaveLength(0)
  })

  it('applies the result cap', () => {
    expect(selectRecall(all, { limit: 1 }, 0, DECAY)).toHaveLength(1)
  })
})
describe('selectDigest', () => {
  it('carries only active in-scope lessons', () => {
    const lessons = [
      lesson({ id: 'active' as LessonId }),
      lesson({ id: 'dormant' as LessonId, status: 'dormant' }),
      lesson({ id: 'foreign' as LessonId, scope: '/other' }),
    ]
    const chosen = selectDigest(lessons, { scope: '/repo', maxLessons: 10 }, 0, DECAY)
    expect(chosen.map(item => item.id)).toEqual(['active'])
  })

  it('applies the lesson cap, highest standing first', () => {
    const lessons = [
      lesson({ id: 'weak' as LessonId }),
      lesson({ id: 'strong' as LessonId, confirmations: 5 }),
    ]
    const chosen = selectDigest(lessons, { scope: '/repo', maxLessons: 1 }, 0, DECAY)
    expect(chosen.map(item => item.id)).toEqual(['strong'])
  })
})

describe('nextStatus', () => {
  it('keeps a fresh lesson active', () => {
    expect(nextStatus(lesson(), 0, DECAY)).toBe('active')
  })

  it('demotes a lesson nothing has confirmed for two half-lives', () => {
    expect(nextStatus(lesson(), 60 * DAY, DECAY)).toBe('dormant')
  })

  it('retires a lesson left uncited long enough', () => {
    expect(nextStatus(lesson(), 200 * DAY, DECAY)).toBe('retired')
  })
})
