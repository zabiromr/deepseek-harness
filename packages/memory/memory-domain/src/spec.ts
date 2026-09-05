/**
 * Durable storage-domain declaration for learned lessons.
 * @module @deepseek-ai/dsh-memory-domain/src/spec
 */

import { z } from 'zod'
import { MEMORY_DOMAIN_NAME, MEMORY_DOMAIN_VERSION } from '@deepseek-ai/dsh-memory'
import type { Lesson, LessonEvidence, LessonId, LessonStatus } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/**
 * Whether cited event numbers are strictly ascending. Written as a running
 * comparison rather than an indexed lookback so the check carries no
 * unreachable bounds branch.
 * @param seq - Cited event sequence numbers.
 * @returns whether each number exceeds the one before it.
 */
function isAscending(seq: readonly number[]): boolean {
  let previous = -1
  for (const value of seq) {
    if (value <= previous) return false
    previous = value
  }
  return true
}

/** Runtime schema for the closed lifecycle vocabulary. */
export const lessonStatusSchema = z.union([
  z.literal('active'),
  z.literal('dormant'),
  z.literal('retired'),
]) satisfies z.ZodType<LessonStatus>

/**
 * Runtime schema for one citation. The ascending-`seq` rule is enforced here
 * as well as at the service boundary, because a hand-edited or partially
 * written medium can carry a citation no service call ever validated.
 */
// Zod infers the branded session id structurally, so it cannot name the public
// interface even though the transform produces the branded output.
export const lessonEvidenceSchema = z.object({
  session: z.string().min(1).transform(value => value as SessionId),
  seq: z.array(nonNegativeSafeInteger).min(1).refine(isAscending, {
    message: 'evidence seq must be strictly ascending',
  }),
}) as unknown as z.ZodType<LessonEvidence>

/**
 * Runtime schema for one stored lesson. `evidence` is capped at one entry
 * minimum: the evidence rule is what makes a lesson trustworthy, so a record
 * that lost its citations is rejected at the durable boundary rather than
 * silently served.
 */
// The interface carries branded and readonly members that zod's structural
// inference cannot reproduce; every field is nonetheless validated above.
export const lessonSchema = z.object({
  id: z.string().min(1),
  scope: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  evidence: z.array(lessonEvidenceSchema).min(1),
  tags: z.array(z.string().min(1)),
  createdAt: nonNegativeSafeInteger,
  lastConfirmedAt: nonNegativeSafeInteger,
  confirmations: nonNegativeSafeInteger,
  contradictions: nonNegativeSafeInteger,
  status: lessonStatusSchema,
}).refine(lesson => lesson.lastConfirmedAt >= lesson.createdAt, {
  path: ['lastConfirmedAt'],
  message: 'lesson lastConfirmedAt must not precede createdAt',
}) as unknown as z.ZodType<Lesson>

/**
 * The one memory domain. `per-record` layout keeps each lesson its own
 * document, so a single stale or malformed lesson is discarded on its own
 * instead of failing the whole store open — a memory that can brick a session
 * on reload is worse than no memory.
 */
export const memoryDomainSpec = defineDomain({
  name: MEMORY_DOMAIN_NAME,
  version: MEMORY_DOMAIN_VERSION,
  layout: 'per-record',
  tables: {
    lessons: domainTable<LessonId, Lesson>(lessonSchema),
  },
})
