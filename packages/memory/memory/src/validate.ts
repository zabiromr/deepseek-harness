/**
 * Request validation shared by every memory provider, so the evidence rule is
 * enforced identically no matter which medium stores the lessons.
 * @module @deepseek-ai/dsh-memory/src/validate
 */

import { MemoryError } from './runtime.ts'
import type { DecayParams, LessonEvidence, RecordLessonRequest } from './types.ts'

/**
 * Accept a provider's configured decay policy, or refuse a policy that can
 * never reclassify. `retireFloor` above `dormantFloor` would retire a lesson
 * before it could become dormant, so the two thresholds would describe an
 * order the scorer cannot produce. Every provider validates through here, so
 * one medium cannot quietly admit a policy another rejects.
 * @param config - The configured thresholds.
 * @returns the same thresholds, as the params a service holds.
 * @throws MemoryError `invalid-request` when `retireFloor` exceeds `dormantFloor`.
 */
export function resolveDecayParams(config: DecayParams): DecayParams {
  if (config.retireFloor > config.dormantFloor) {
    throw new MemoryError(
      'invalid-request',
      `retireFloor ${config.retireFloor} must not exceed dormantFloor ${config.dormantFloor}`,
    )
  }
  return {
    halfLifeMs: config.halfLifeMs,
    dormantFloor: config.dormantFloor,
    retireFloor: config.retireFloor,
  }
}

/**
 * Require at least one well-formed citation.
 *
 * This is the load-bearing rule of the capability: a lesson that cannot point
 * at the session events that produced it is not auditable, and an unauditable
 * lesson must never re-enter a prompt. Each citation must name at least one
 * event and list its sequence numbers in strictly ascending order, so a
 * reader can replay the citation against the session log without guessing.
 * @param evidence - Citations supplied by the caller.
 * @throws MemoryError `missing-evidence` when empty, `invalid-evidence` when a citation is malformed.
 */
export function assertEvidence(evidence: readonly LessonEvidence[]): void {
  if (evidence.length === 0) {
    throw new MemoryError('missing-evidence', 'a lesson requires at least one evidence citation')
  }
  for (const citation of evidence) {
    if (citation.seq.length === 0) {
      throw new MemoryError(
        'invalid-evidence',
        `evidence for session '${citation.session}' cites no event sequence numbers`,
      )
    }
    let previous = -1
    for (const seq of citation.seq) {
      if (!Number.isInteger(seq) || seq < 0) {
        throw new MemoryError(
          'invalid-evidence',
          `evidence for session '${citation.session}' carries a non-ordinal seq ${seq}`,
        )
      }
      if (seq <= previous) {
        throw new MemoryError(
          'invalid-evidence',
          `evidence for session '${citation.session}' lists seq ${seq} out of ascending order`,
        )
      }
      previous = seq
    }
  }
}

/**
 * Validate a capture request in full.
 * @param request - The caller's record request.
 * @throws MemoryError `invalid-request` for an empty title or body, or the evidence codes from {@link assertEvidence}.
 */
export function assertRecordRequest(request: RecordLessonRequest): void {
  if (request.title.trim() === '') {
    throw new MemoryError('invalid-request', 'a lesson requires a non-empty title')
  }
  if (request.body.trim() === '') {
    throw new MemoryError('invalid-request', 'a lesson requires a non-empty body')
  }
  if (request.scope.trim() === '') {
    throw new MemoryError('invalid-request', 'a lesson requires a non-empty scope')
  }
  assertEvidence(request.evidence)
}

/**
 * Validate a positive result cap.
 * @param limit - Caller-supplied maximum result count.
 * @param field - Field name quoted in the failure message.
 * @throws MemoryError `invalid-request` when the limit is not a positive integer.
 */
export function assertLimit(limit: number, field: string): void {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new MemoryError('invalid-request', `${field} must be a positive integer, received ${limit}`)
  }
}
