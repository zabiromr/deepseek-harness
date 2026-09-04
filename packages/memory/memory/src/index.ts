/**
 * Service Definition for the memory capability seam (`ctx.memory`): an abstract
 * service defining WHAT durable, evidence-bound lessons are — capture,
 * confirmation, recall, digest selection, and decay reclassification — without
 * saying HOW they are stored. Implementations subclass {@link MemoryService}
 * and register as the `memory` service; `@deepseek-ai/dsh-memory-domain`
 * (storage-domain backed) is the first.
 *
 * The seam owns the vocabulary and the two rules that make learned memory
 * trustworthy rather than merely large: every lesson cites the session events
 * that produced it, and every lesson's standing decays unless later evidence
 * confirms it. It owns NO prompt assembly (that is
 * `@deepseek-ai/dsh-memory-prompt`), NO scheduling of reclassification (that is
 * `@deepseek-ai/dsh-memory-decay`), and NO model-facing tool.
 *
 * @module @deepseek-ai/dsh-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  DecayParams,
  DigestQuery,
  Lesson,
  LessonEvidence,
  LessonId,
  RecallQuery,
  ReclassifySummary,
  RecordLessonRequest,
} from './types.ts'

export type * from './types.ts'
export { GLOBAL_SCOPE } from './types.ts'
export { MemoryError, createLessonId, promised, MEMORY_DOMAIN_NAME, MEMORY_DOMAIN_VERSION } from './runtime.ts'
export type { MemoryErrorCode } from './runtime.ts'
export { compareRanked, scoreLesson, statusForScore } from './score.ts'
export { assertEvidence, assertLimit, assertRecordRequest, resolveDecayParams } from './validate.ts'
export {
  buildLesson,
  copyEvidence,
  inScope,
  matchesText,
  nextStatus,
  rankLessons,
  restateLesson,
  selectDigest,
  selectRecall,
} from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}

/**
 * Abstract learned-memory service. Subclass, implement every member, and load
 * the subclass as a plugin — it registers as `ctx.memory` (one implementation
 * per context; loading a second throws, cordis' standard duplicate-service
 * behavior).
 *
 * Semantics every implementation must honor:
 * - {@link record} REJECTS a request citing no evidence, before any write.
 * - {@link confirm} and {@link contradict} require NEW evidence and are the only
 *   ways a lesson's standing rises; nothing infers confirmation from a session
 *   merely completing.
 * - {@link recall} searches every status by default, so a decayed lesson stays
 *   auditable; {@link digest} returns only `active` lessons.
 * - EVERY method reports failure by REJECTING, never by throwing before it
 *   returns; a provider with a synchronous body wraps it in `promised`.
 * - {@link reclassify} is pure arithmetic over stored records — it makes no
 *   model calls and never deletes a lesson.
 */
export abstract class MemoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  /** Decay parameters this implementation ranks and reclassifies by. */
  abstract readonly decay: DecayParams

  /**
   * Capture one lesson with its citations.
   * @param request - Scope, title, body, evidence, and tags.
   * @returns the stored lesson; rejects with `missing-evidence` when uncited.
   */
  abstract record(request: RecordLessonRequest): Promise<Lesson>

  /**
   * Raise a lesson's standing with new evidence and reset its decay clock.
   * @param id - The lesson to confirm.
   * @param evidence - New citations supporting it; never empty.
   * @returns the updated lesson; rejects `not-found` for an unknown id.
   */
  abstract confirm(id: LessonId, evidence: readonly LessonEvidence[]): Promise<Lesson>

  /**
   * Lower a lesson's standing with evidence against it.
   * @param id - The lesson to contradict.
   * @param evidence - New citations against it; never empty.
   * @returns the updated lesson; rejects `not-found` for an unknown id.
   */
  abstract contradict(id: LessonId, evidence: readonly LessonEvidence[]): Promise<Lesson>

  /**
   * Search stored lessons, highest score first.
   * @param query - Text, tag, scope, and status filters plus a result cap.
   * @returns the matching lessons, ranked.
   */
  abstract recall(query: RecallQuery): Promise<readonly Lesson[]>

  /**
   * Select the `active` lessons that belong in the always-on prompt digest.
   * @param query - Scope and lesson cap.
   * @returns the selected lessons, highest score first.
   */
  abstract digest(query: DigestQuery): Promise<readonly Lesson[]>

  /**
   * Read one lesson by id.
   * @param id - The lesson to read.
   * @returns the lesson, or `undefined` when absent.
   */
  abstract get(id: LessonId): Promise<Lesson | undefined>

  /**
   * Apply decay to every stored lesson's status, using {@link decay}.
   * @param now - Epoch milliseconds to evaluate at.
   * @returns counts of what moved.
   */
  abstract reclassify(now: number): Promise<ReclassifySummary>
}

export default MemoryService
