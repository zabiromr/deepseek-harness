/**
 * Scoring and decay arithmetic, owned here so the provider (which ranks) and
 * the decay policy (which reclassifies) share one implementation and can never
 * disagree about what a lesson is worth.
 * @module @deepseek-ai/dsh-memory/src/score
 */

import type { DecayParams, Lesson, LessonStatus } from './types.ts'

/**
 * Score one lesson at a moment in time.
 *
 * The standing weight is `confirmations - 2 * contradictions + 1`: a freshly
 * captured lesson starts at 1, each independent confirmation adds 1, and each
 * contradiction removes 2. The asymmetry is deliberate — a lesson that has
 * actively misled the agent costs more than an unconfirmed one, so two
 * lukewarm confirmations do not rescue a lesson that was wrong once.
 *
 * That weight then halves every `halfLifeMs` since the last confirmation, so a
 * lesson nothing re-confirms fades on its own without any judgement call.
 * @param lesson - The lesson to score.
 * @param now - Epoch milliseconds to score at.
 * @param params - Decay parameters; only `halfLifeMs` participates.
 * @returns the decayed score, which may be zero or negative.
 */
export function scoreLesson(lesson: Lesson, now: number, params: DecayParams): number {
  const standing = lesson.confirmations - 2 * lesson.contradictions + 1
  const age = Math.max(0, now - lesson.lastConfirmedAt)
  return standing * Math.pow(0.5, age / params.halfLifeMs)
}

/**
 * The status a lesson's score entitles it to. Status only ever falls: a
 * `retired` lesson stays retired until new evidence confirms it, which resets
 * `lastConfirmedAt` and lifts the score by construction.
 * @param score - The lesson's decayed score.
 * @param params - Decay parameters supplying both floors.
 * @returns the entitled status.
 */
export function statusForScore(score: number, params: DecayParams): LessonStatus {
  if (score <= params.retireFloor) return 'retired'
  if (score <= params.dormantFloor) return 'dormant'
  return 'active'
}

/**
 * Order two lessons for ranking: higher score first, then the more recently
 * confirmed, then by id so the order is total and reproducible across runs.
 * @param a - Left lesson and its score.
 * @param b - Right lesson and its score.
 * @returns a comparator result.
 */
export function compareRanked(
  a: { readonly lesson: Lesson; readonly score: number },
  b: { readonly lesson: Lesson; readonly score: number },
): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.lesson.lastConfirmedAt !== b.lesson.lastConfirmedAt) {
    return b.lesson.lastConfirmedAt - a.lesson.lastConfirmedAt
  }
  return a.lesson.id < b.lesson.id ? -1 : a.lesson.id > b.lesson.id ? 1 : 0
}
