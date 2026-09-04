/**
 * Pure payload vocabulary of the memory capability: the durable {@link Lesson}
 * record and the request/query payloads every provider and consumer speaks.
 * Kept free of runtime code so consumers can import the types without pulling
 * the service implementation.
 * @module @deepseek-ai/dsh-memory/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Opaque identity of one stored lesson. */
export type LessonId = Branded<'LessonId'>

/**
 * Scope a lesson applies to: an absolute workspace directory, or
 * {@link GLOBAL_SCOPE} for lessons that hold everywhere. A digest for a
 * workspace draws from that workspace and the global scope, never from a
 * sibling workspace.
 */
export type LessonScope = string

/** Scope value naming every workspace. */
export const GLOBAL_SCOPE = '*'

/**
 * One citation backing a lesson: the session that produced the evidence and
 * the sequence numbers of the events within it. A lesson without at least one
 * citation is rejected — an uncitable lesson cannot be audited, so it cannot
 * be trusted enough to re-enter a prompt.
 */
export interface LessonEvidence {
  /** Session the cited events belong to. */
  readonly session: SessionId
  /** Sequence numbers of the cited events, ascending and non-empty. */
  readonly seq: readonly number[]
}

/**
 * Lifecycle of a stored lesson. Only `active` lessons reach the digest;
 * `dormant` and `retired` remain recallable so a decayed lesson stays
 * auditable rather than vanishing.
 */
export type LessonStatus = 'active' | 'dormant' | 'retired'

/** One durable lesson: what to do differently, and the evidence for it. */
export interface Lesson {
  /** Stable identity. */
  readonly id: LessonId
  /** Workspace this lesson applies to, or {@link GLOBAL_SCOPE}. */
  readonly scope: LessonScope
  /** One line stating what to do differently. */
  readonly title: string
  /** The lesson itself, including the circumstances it applies to. */
  readonly body: string
  /** Citations backing the lesson; never empty. */
  readonly evidence: readonly LessonEvidence[]
  /** Free-form retrieval tags. */
  readonly tags: readonly string[]
  /** Epoch milliseconds of first capture. */
  readonly createdAt: number
  /** Epoch milliseconds of the most recent confirmation, or of capture when never confirmed. */
  readonly lastConfirmedAt: number
  /** How many times later evidence confirmed this lesson. */
  readonly confirmations: number
  /** How many times later evidence contradicted it. */
  readonly contradictions: number
  /** Current lifecycle status. */
  readonly status: LessonStatus
}

/** Request payload capturing a new lesson. */
export interface RecordLessonRequest {
  /** Workspace the lesson applies to, or {@link GLOBAL_SCOPE}. */
  readonly scope: LessonScope
  /** One line stating what to do differently. */
  readonly title: string
  /** The lesson itself. */
  readonly body: string
  /** Citations backing it; a request with none is rejected. */
  readonly evidence: readonly LessonEvidence[]
  /** Free-form retrieval tags. */
  readonly tags?: readonly string[]
}

/** Query payload for {@link MemoryService.recall}. */
export interface RecallQuery {
  /** Case-insensitive substring matched against title, body, and tags. Absent matches every lesson. */
  readonly text?: string
  /** Restrict to lessons carrying every listed tag. */
  readonly tags?: readonly string[]
  /** Restrict to this workspace plus {@link GLOBAL_SCOPE}. Absent searches every scope. */
  readonly scope?: LessonScope
  /** Statuses to include. Absent includes every status, so a decayed lesson stays findable. */
  readonly statuses?: readonly LessonStatus[]
  /** Maximum lessons returned, highest score first. */
  readonly limit: number
}

/** Selection payload for the always-on prompt digest. */
export interface DigestQuery {
  /** Workspace whose lessons are drawn, alongside {@link GLOBAL_SCOPE}. */
  readonly scope: LessonScope
  /** Maximum lessons returned, highest score first. */
  readonly maxLessons: number
}

/** Outcome of one {@link MemoryService.reclassify} pass. */
export interface ReclassifySummary {
  /** Lessons that moved from `active` to `dormant`. */
  readonly demoted: number
  /** Lessons that moved to `retired`. */
  readonly retired: number
  /** Lessons whose status was left unchanged. */
  readonly unchanged: number
}

/** Decay parameters shared by scoring and reclassification. */
export interface DecayParams {
  /** Milliseconds over which an unconfirmed lesson's score halves. */
  readonly halfLifeMs: number
  /** Score at or below which an `active` lesson becomes `dormant`. */
  readonly dormantFloor: number
  /** Score at or below which a lesson becomes `retired`. */
  readonly retireFloor: number
}
