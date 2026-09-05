/**
 * The scoring and decay arithmetic: what a lesson is worth, how fast it fades,
 * and how a total ranking order is produced.
 */

import { describe, expect, it } from 'vitest'
import { compareRanked, scoreLesson, statusForScore } from '../src/score.ts'
import type { DecayParams, Lesson, LessonId } from '../src/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

const DAY = 24 * 60 * 60 * 1000

const DECAY: DecayParams = { halfLifeMs: 30 * DAY, dormantFloor: 0.25, retireFloor: 0.05 }

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'lesson-a' as LessonId,
    scope: '/repo',
    title: 'title',
    body: 'body',
    evidence: [{ session: 's1' as SessionId, seq: [1] }],
    tags: [],
    createdAt: 0,
    lastConfirmedAt: 0,
    confirmations: 0,
    contradictions: 0,
    status: 'active',
    ...overrides,
  }
}

describe('scoreLesson', () => {
  it('scores a freshly captured lesson at one', () => {
    expect(scoreLesson(lesson(), 0, DECAY)).toBe(1)
  })

  it('adds one for each confirmation', () => {
    expect(scoreLesson(lesson({ confirmations: 2 }), 0, DECAY)).toBe(3)
  })

  it('removes two for each contradiction, so one wrong turn outweighs one confirmation', () => {
    expect(scoreLesson(lesson({ confirmations: 1, contradictions: 1 }), 0, DECAY)).toBe(0)
  })

  it('lets a contradicted lesson score negative', () => {
    expect(scoreLesson(lesson({ contradictions: 1 }), 0, DECAY)).toBe(-1)
  })

  it('halves the standing after one half-life without confirmation', () => {
    expect(scoreLesson(lesson(), 30 * DAY, DECAY)).toBeCloseTo(0.5, 10)
  })

  it('halves again after a second half-life', () => {
    expect(scoreLesson(lesson(), 60 * DAY, DECAY)).toBeCloseTo(0.25, 10)
  })

  it('measures age from the last confirmation, not from capture', () => {
    const confirmed = lesson({ createdAt: 0, lastConfirmedAt: 60 * DAY })
    expect(scoreLesson(confirmed, 60 * DAY, DECAY)).toBe(1)
  })

  it('treats a clock that moved backwards as no elapsed time rather than as growth', () => {
    expect(scoreLesson(lesson({ lastConfirmedAt: 10 * DAY }), 0, DECAY)).toBe(1)
  })
})

describe('statusForScore', () => {
  it('keeps a lesson above both floors active', () => {
    expect(statusForScore(1, DECAY)).toBe('active')
  })

  it('demotes a lesson at the dormant floor', () => {
    expect(statusForScore(0.25, DECAY)).toBe('dormant')
  })

  it('retires a lesson at the retire floor', () => {
    expect(statusForScore(0.05, DECAY)).toBe('retired')
  })

  it('retires a negative score, so a contradicted lesson leaves the digest at once', () => {
    expect(statusForScore(-1, DECAY)).toBe('retired')
  })
})

describe('compareRanked', () => {
  it('orders the higher score first', () => {
    const a = { lesson: lesson(), score: 2 }
    const b = { lesson: lesson(), score: 1 }
    expect([b, a].sort(compareRanked)[0]).toBe(a)
  })

  it('breaks a score tie with the more recent confirmation', () => {
    const fresh = { lesson: lesson({ lastConfirmedAt: 10 }), score: 1 }
    const stale = { lesson: lesson({ lastConfirmedAt: 5 }), score: 1 }
    expect([stale, fresh].sort(compareRanked)[0]).toBe(fresh)
  })

  it('breaks a full tie by id so the order is total and reproducible', () => {
    const first = { lesson: lesson({ id: 'a' as LessonId }), score: 1 }
    const second = { lesson: lesson({ id: 'b' as LessonId }), score: 1 }
    expect([second, first].sort(compareRanked)[0]).toBe(first)
    expect([first, second].sort(compareRanked)[0]).toBe(first)
  })

  it('reports identical entries as equal', () => {
    const only = { lesson: lesson(), score: 1 }
    expect(compareRanked(only, only)).toBe(0)
  })
})
