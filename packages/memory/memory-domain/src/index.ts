/**
 * Storage-domain backed provider for the memory capability seam: the first
 * implementation of `ctx.memory`. It owns the durable lesson records and the
 * two rules that make learned memory trustworthy — every lesson cites the
 * session events that produced it, and every lesson's standing decays unless
 * later evidence confirms it.
 * @module @deepseek-ai/dsh-memory-domain
 */

/* jscpd:ignore-start -- two providers of one Service Definition draw on the
 * same capability surface, so their import lists coincide by construction. */
import { Context, Service } from '@deepseek-ai/cordis'
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
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { memoryDomainSpec } from './spec.ts'

export { lessonEvidenceSchema, lessonSchema, lessonStatusSchema, memoryDomainSpec } from './spec.ts'

/**
 * Plugin config. Every field is a deployment choice with no universally
 * correct value: how fast an unconfirmed lesson should fade, and where the two
 * status floors sit, depend on how often the deployment runs sessions.
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

/**
 * The durable memory service. Opens the `memory` domain at init and serves
 * capture, confirmation, recall, digest selection, and decay reclassification
 * from the domain's in-memory state, so a read never goes around the write
 * chain to the medium.
 */
export class DomainMemoryService extends MemoryService {
  static inject = ['storageDomain']

  static Config: s<Config> = Config

  readonly decay: DecayParams

  private table?: KvTable<LessonId, Lesson>

  /**
   * @param ctx - Host context carrying the storage-domain form.
   * @param config - Required decay policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.decay = resolveDecayParams(config)
  }

  /** Open and own the one memory domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'memory-domain.domainClose')
    this.table = domain.table('lessons')
  }

  /**
   * Capture one lesson with its citations.
   * @param request - Scope, title, body, evidence, and tags.
   * @returns the stored lesson.
   */
  async record(request: RecordLessonRequest): Promise<Lesson> {
    assertRecordRequest(request)
    const lesson = buildLesson(request, Date.now())
    await this.requireTable().put(lesson.id, lesson)
    return lesson
  }

  /**
   * Raise a lesson's standing with new evidence and reset its decay clock.
   * @param id - The lesson to confirm.
   * @param evidence - New citations supporting it.
   * @returns the updated lesson.
   */
  async confirm(id: LessonId, evidence: readonly LessonEvidence[]): Promise<Lesson> {
    return await this.restate(id, evidence, 'confirm')
  }

  /**
   * Lower a lesson's standing with evidence against it.
   * @param id - The lesson to contradict.
   * @param evidence - New citations against it.
   * @returns the updated lesson.
   */
  async contradict(id: LessonId, evidence: readonly LessonEvidence[]): Promise<Lesson> {
    return await this.restate(id, evidence, 'contradict')
  }

  /**
   * Search stored lessons, highest score first.
   * @param query - Text, tag, scope, and status filters plus a result cap.
   * @returns the matching lessons, ranked.
   */
  recall(query: RecallQuery): Promise<readonly Lesson[]> {
    return promised(() => {
      assertLimit(query.limit, 'recall limit')
      const lessons = [...this.requireTable().entries()].map(entry => entry[1])
      return selectRecall(lessons, query, Date.now(), this.decay)
    })
  }

  /**
   * Select the active lessons that belong in the always-on prompt digest.
   *
   * Ranking is by decayed score within scope, NOT by relevance to the current
   * task: at prompt-assembly time the task is not yet known, so a relevance
   * signal here would be a guess. Query-driven relevance belongs to
   * {@link recall}.
   * @param query - Scope and lesson cap.
   * @returns the selected lessons, highest score first.
   */
  digest(query: DigestQuery): Promise<readonly Lesson[]> {
    return promised(() => {
      assertLimit(query.maxLessons, 'digest maxLessons')
      const lessons = [...this.requireTable().entries()].map(entry => entry[1])
      return selectDigest(lessons, query, Date.now(), this.decay)
    })
  }

  /**
   * Read one lesson by id.
   * @param id - The lesson to read.
   * @returns the lesson, or `undefined` when absent.
   */
  get(id: LessonId): Promise<Lesson | undefined> {
    return promised(() => this.requireTable().get(id))
  }

  /**
   * Apply decay to every stored lesson's status.
   *
   * Status only ever falls here: a rise requires new evidence through
   * {@link confirm}, which resets the decay clock. Nothing is deleted — a
   * retired lesson stays recallable so the record of what was once believed
   * remains auditable.
   * @param now - Epoch milliseconds to evaluate at.
   * @returns counts of what moved.
   */
  async reclassify(now: number): Promise<ReclassifySummary> {
    const table = this.requireTable()
    let demoted = 0
    let retired = 0
    let unchanged = 0
    for (const [id, lesson] of [...table.entries()]) {
      const next = nextStatus(lesson, now, this.decay)
      if (next === lesson.status) {
        unchanged += 1
        continue
      }
      await table.put(id, { ...lesson, status: next })
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
  private async restate(
    id: LessonId,
    evidence: readonly LessonEvidence[],
    kind: 'confirm' | 'contradict',
  ): Promise<Lesson> {
    assertEvidence(evidence)
    const table = this.requireTable()
    const current = table.get(id)
    if (current === undefined) {
      throw new MemoryError('not-found', `no lesson with id '${id}'`)
    }
    const settled = restateLesson(current, evidence, kind, Date.now(), this.decay)
    await table.put(id, settled)
    return settled
  }

  /** Resolve the initialized durable table or fail a broken service lifecycle. */
  private requireTable(): KvTable<LessonId, Lesson> {
    if (this.table === undefined) {
      throw new MemoryError('store-unavailable', 'memory-domain: durable domain is not initialized')
    }
    return this.table
  }
}

export default DomainMemoryService
