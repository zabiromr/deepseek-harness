/**
 * The medium-independent half of the memory capability: building, restating,
 * filtering, and ranking lessons as pure functions over a record collection.
 *
 * Every provider adapts its medium to these functions rather than reimplementing
 * them, so a durable store and an in-process one can never disagree about what
 * a lesson is worth, which lessons a digest shows, or what a confirmation does.
 * @module @deepseek-ai/dsh-memory/src/store
 */

import { compareRanked, scoreLesson, statusForScore } from './score.ts'
import { createLessonId } from './runtime.ts'
import { GLOBAL_SCOPE } from './types.ts'
import type {
  DecayParams,
  DigestQuery,
  Lesson,
  LessonEvidence,
  LessonStatus,
  RecallQuery,
  RecordLessonRequest,
} from './types.ts'

/** Every status, used when a recall query names none. */
const ALL_STATUSES: readonly LessonStatus[] = ['active', 'dormant', 'retired']

/**
 * Copy one citation so a stored lesson never aliases caller-owned arrays.
 * @param evidence - The caller's citation.
 * @returns an owned copy.
 */
export function copyEvidence(evidence: LessonEvidence): LessonEvidence {
  return { session: evidence.session, seq: [...evidence.seq] }
}

/**
 * Build the stored form of a newly captured lesson. The request is assumed
 * already validated by the caller.
 * @param request - Scope, title, body, evidence, and tags.
 * @param now - Epoch milliseconds of capture.
 * @returns the lesson to store.
 */
export function buildLesson(request: RecordLessonRequest, now: number): Lesson {
  return {
    id: createLessonId(),
    scope: request.scope,
    title: request.title,
    body: request.body,
    evidence: request.evidence.map(copyEvidence),
    tags: [...(request.tags ?? [])],
    createdAt: now,
    lastConfirmedAt: now,
    confirmations: 0,
    contradictions: 0,
    status: 'active',
  }
}

/**
 * Apply one confirmation or contradiction to a stored lesson.
 *
 * A confirmation resets the decay clock; a contradiction deliberately does
 * NOT, because arguing against a stale lesson would otherwise freshen it. The
 * resulting status is recomputed immediately, so a contradiction that pushes a
 * lesson below the floors takes it out of the digest without waiting for the
 * next sweep.
 * @param current - The stored lesson.
 * @param evidence - New citations; assumed already validated.
 * @param kind - Which counter rises.
 * @param now - Epoch milliseconds of the restatement.
 * @param decay - Decay parameters for the recomputed status.
 * @returns the lesson to store.
 */
export function restateLesson(
  current: Lesson,
  evidence: readonly LessonEvidence[],
  kind: 'confirm' | 'contradict',
  now: number,
  decay: DecayParams,
): Lesson {
  const confirming = kind === 'confirm'
  const restated: Lesson = {
    ...current,
    evidence: [...current.evidence, ...evidence.map(copyEvidence)],
    confirmations: current.confirmations + (confirming ? 1 : 0),
    contradictions: current.contradictions + (confirming ? 0 : 1),
    lastConfirmedAt: confirming ? now : current.lastConfirmedAt,
  }
  return { ...restated, status: statusForScore(scoreLesson(restated, now, decay), decay) }
}

/**
 * Whether a lesson applies to a workspace. A digest for one workspace draws
 * from that workspace and the global scope, never from a sibling workspace.
 * @param lesson - The candidate lesson.
 * @param scope - The workspace being served.
 * @returns whether the lesson is in scope.
 */
export function inScope(lesson: Lesson, scope: string): boolean {
  return lesson.scope === scope || lesson.scope === GLOBAL_SCOPE
}

/**
 * Whether a lesson matches a lowercased search needle.
 * @param lesson - The candidate lesson.
 * @param needle - Lowercased substring.
 * @returns whether title, body, or any tag contains the needle.
 */
export function matchesText(lesson: Lesson, needle: string): boolean {
  if (lesson.title.toLowerCase().includes(needle)) return true
  if (lesson.body.toLowerCase().includes(needle)) return true
  return lesson.tags.some(tag => tag.toLowerCase().includes(needle))
}

/**
 * Rank and cap a candidate set by decayed score.
 * @param lessons - Candidates that already passed every filter.
 * @param now - Epoch milliseconds to score at.
 * @param decay - Decay parameters.
 * @param limit - Maximum results.
 * @returns the ranked, capped lessons.
 */
export function rankLessons(
  lessons: readonly Lesson[],
  now: number,
  decay: DecayParams,
  limit: number,
): readonly Lesson[] {
  return lessons
    .map(lesson => ({ lesson, score: scoreLesson(lesson, now, decay) }))
    .sort(compareRanked)
    .slice(0, limit)
    .map(ranked => ranked.lesson)
}

/**
 * Select the lessons a recall query matches, ranked and capped.
 * @param lessons - Every stored lesson.
 * @param query - Text, tag, scope, and status filters plus a result cap.
 * @param now - Epoch milliseconds to score at.
 * @param decay - Decay parameters.
 * @returns the matching lessons, highest score first.
 */
export function selectRecall(
  lessons: Iterable<Lesson>,
  query: RecallQuery,
  now: number,
  decay: DecayParams,
): readonly Lesson[] {
  const statuses = new Set<string>(query.statuses ?? ALL_STATUSES)
  const needle = query.text?.toLowerCase()
  const matches: Lesson[] = []
  for (const lesson of lessons) {
    if (!statuses.has(lesson.status)) continue
    if (query.scope !== undefined && !inScope(lesson, query.scope)) continue
    if (query.tags !== undefined && !query.tags.every(tag => lesson.tags.includes(tag))) continue
    if (needle !== undefined && !matchesText(lesson, needle)) continue
    matches.push(lesson)
  }
  return rankLessons(matches, now, decay, query.limit)
}

/**
 * Select the active lessons that belong in the always-on prompt digest.
 *
 * Ranking is by decayed score within scope, NOT by relevance to the current
 * task: at prompt-assembly time the task is not yet known, so a relevance
 * signal here would be a guess. Query-driven relevance belongs to recall.
 * @param lessons - Every stored lesson.
 * @param query - Scope and lesson cap.
 * @param now - Epoch milliseconds to score at.
 * @param decay - Decay parameters.
 * @returns the selected lessons, highest score first.
 */
export function selectDigest(
  lessons: Iterable<Lesson>,
  query: DigestQuery,
  now: number,
  decay: DecayParams,
): readonly Lesson[] {
  const matches: Lesson[] = []
  for (const lesson of lessons) {
    if (lesson.status !== 'active') continue
    if (!inScope(lesson, query.scope)) continue
    matches.push(lesson)
  }
  return rankLessons(matches, now, decay, query.maxLessons)
}

/**
 * The status one stored lesson is entitled to at a moment in time.
 * @param lesson - The stored lesson.
 * @param now - Epoch milliseconds to evaluate at.
 * @param decay - Decay parameters.
 * @returns the entitled status, which may equal the current one.
 */
export function nextStatus(lesson: Lesson, now: number, decay: DecayParams): LessonStatus {
  return statusForScore(scoreLesson(lesson, now, decay), decay)
}
