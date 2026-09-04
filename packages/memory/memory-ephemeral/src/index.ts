/**
 * In-process provider for the memory capability seam: lessons live in a Map
 * for the lifetime of the host and are gone when it exits.
 *
 * It exists for the cases where durability is wrong rather than merely absent —
 * schema generation and tests, which must not touch a real store, and
 * short-lived or sandboxed deployments where lessons should not outlive the
 * process. Selection, scoring, and restatement all come from the seam's shared
 * store functions, so this provider and the durable one cannot disagree about
 * what a lesson is worth.
 * @module @deepseek-ai/dsh-memory-ephemeral
 */

/* jscpd:ignore-start -- two providers of one Service Definition draw on the
 * same capability surface, so their import lists coincide by construction. */
import { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import {
  assertEvidence,
  assertLimit,
  assertRecordRequest,
  buildLesson,
  MemoryError,
  MemoryService,
  nextStatus,
  promised,
  resolveDecayParams,
  restateLesson,
  selectDigest,
  selectRecall,
} from '@deepseek-ai/dsh-memory'
import type {
  DecayParams,
  DigestQuery,
  Lesson,
  LessonEvidence,
  LessonId,
  RecallQuery,
  ReclassifySummary,
  RecordLessonRequest,
} from '@deepseek-ai/dsh-memory'
/* jscpd:ignore-end */

/**
 * Plugin config. The decay parameters mean the same thing here as in the
 * durable provider; a deployment that swaps providers keeps its policy.
 */
export type Config = DecayParams

/* jscpd:ignore-start -- gen-config-catalog statically walks this expression to
 * document the fields, so each provider states the literal schema even though
 * the shape and its rule are owned by the capability package. */
export const Config: s<Config> = s.object({
  halfLifeMs: s.natural().min(1).required(),
  dormantFloor: s.number().required(),
  retireFloor: s.number().required(),
})
/* jscpd:ignore-end */

/** The in-process memory service. */
export class EphemeralMemoryService extends MemoryService {
  static Config: s<Config> = Config

  readonly decay: DecayParams

  private readonly lessons = new Map<LessonId, Lesson>()

  /**
   * @param ctx - Host context.
   * @param config - Required decay policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.decay = resolveDecayParams(config)
  }

  /**
   * Capture one lesson with its citations.
   * @param request - Scope, title, body, evidence, and tags.
   * @returns the stored lesson.
   */
  record(request: RecordLessonRequest): Promise<Lesson> {
    return promised(() => {
      assertRecordRequest(request)
      const lesson = buildLesson(request, Date.now())
      this.lessons.set(lesson.id, lesson)
      return lesson
    })
  }

  /**
   * Raise a lesson's standing with new evidence and reset its decay clock.
   * @param id - The lesson to confirm.
   * @param evidence - New citations supporting it.
   * @returns the updated lesson.
   */
  confirm(id: LessonId, evidence: readonly LessonEvidence[]): Promise<Lesson> {
    return promised(() => this.restate(id, evidence, 'confirm'))
  }

  /**
   * Lower a lesson's standing with evidence against it.
   * @param id - The lesson to contradict.
   * @param evidence - New citations against it.
   * @returns the updated lesson.
   */
  contradict(id: LessonId, evidence: readonly LessonEvidence[]): Promise<Lesson> {
    return promised(() => this.restate(id, evidence, 'contradict'))
  }

  /**
   * Search stored lessons, highest score first.
   * @param query - Text, tag, scope, and status filters plus a result cap.
   * @returns the matching lessons, ranked.
   */
  recall(query: RecallQuery): Promise<readonly Lesson[]> {
    return promised(() => {
      assertLimit(query.limit, 'recall limit')
      return selectRecall(this.lessons.values(), query, Date.now(), this.decay)
    })
  }

  /**
   * Select the active lessons that belong in the always-on prompt digest.
   * @param query - Scope and lesson cap.
   * @returns the selected lessons, highest score first.
   */
  digest(query: DigestQuery): Promise<readonly Lesson[]> {
    return promised(() => {
      assertLimit(query.maxLessons, 'digest maxLessons')
      return selectDigest(this.lessons.values(), query, Date.now(), this.decay)
    })
  }

  /**
   * Read one lesson by id.
   * @param id - The lesson to read.
   * @returns the lesson, or `undefined` when absent.
   */
  get(id: LessonId): Promise<Lesson | undefined> {
    return promised(() => this.lessons.get(id))
  }

  /**
   * Apply decay to every stored lesson's status.
   * @param now - Epoch milliseconds to evaluate at.
   * @returns counts of what moved.
   */
  reclassify(now: number): Promise<ReclassifySummary> {
    return promised(() => this.sweep(now))
  }

  /**
   * Recompute every stored lesson's status.
   * @param now - Epoch milliseconds to evaluate at.
   * @returns counts of what moved.
   */
  private sweep(now: number): ReclassifySummary {
    let demoted = 0
    let retired = 0
    let unchanged = 0
    for (const [id, lesson] of [...this.lessons]) {
      const next = nextStatus(lesson, now, this.decay)
      if (next === lesson.status) {
        unchanged += 1
        continue
      }
      this.lessons.set(id, { ...lesson, status: next })
      if (next === 'retired') retired += 1
      else demoted += 1
    }
    return { demoted, retired, unchanged }
  }

  /**
   * Apply one confirmation or contradiction.
   * @param id - The lesson to restate.
   * @param evidence - New citations; never empty.
   * @param kind - Which counter rises.
   * @returns the updated lesson.
   */
  private restate(
    id: LessonId,
    evidence: readonly LessonEvidence[],
    kind: 'confirm' | 'contradict',
  ): Lesson {
    assertEvidence(evidence)
    const current = this.lessons.get(id)
    if (current === undefined) {
      throw new MemoryError('not-found', `no lesson with id '${id}'`)
    }
    const settled = restateLesson(current, evidence, kind, Date.now(), this.decay)
    this.lessons.set(id, settled)
    return settled
  }
}

export default EphemeralMemoryService
