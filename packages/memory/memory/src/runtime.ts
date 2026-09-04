/**
 * Runtime vocabulary of the memory capability: the error type every provider
 * raises and the identity factory for stored lessons.
 * @module @deepseek-ai/dsh-memory/src/runtime
 */

import { randomUUID } from 'node:crypto'
import type { LessonId } from './types.ts'

/**
 * Closed set of memory failures. Providers raise these and nothing else, so a
 * consumer can branch on the cause without parsing messages.
 *
 * - `missing-evidence` — a record, confirm, or contradict call cited nothing.
 * - `invalid-evidence` — a citation carried an empty or non-ascending `seq`.
 * - `not-found` — the addressed lesson is absent.
 * - `invalid-request` — a field violated its documented range (empty title, non-positive limit).
 * - `store-unavailable` — the durable medium could not be read or written.
 */
export type MemoryErrorCode =
  | 'missing-evidence'
  | 'invalid-evidence'
  | 'not-found'
  | 'invalid-request'
  | 'store-unavailable'

/** Error raised by every memory provider. */
export class MemoryError extends Error {
  /**
   * @param code - Which documented failure occurred.
   * @param message - Human-readable detail naming the offending field or id.
   * @param options - Standard error options; `cause` carries a backend failure.
   */
  constructor(
    readonly code: MemoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MemoryError'
  }
}

/**
 * Mint one lesson identity.
 * @returns a fresh opaque {@link LessonId}.
 */
export function createLessonId(): LessonId {
  return randomUUID() as LessonId
}

/** Domain format version stamped on the durable medium. */
export const MEMORY_DOMAIN_VERSION = 1

/**
 * Name of the durable memory domain. Declared here rather than in the provider
 * so the provider's schema and its invariant companion — separate entry points
 * that must not share a module — cannot drift apart on it.
 */
export const MEMORY_DOMAIN_NAME = 'memory'

/**
 * Run a synchronous body as a promise, turning a thrown failure into a
 * rejection.
 *
 * Every {@link MemoryService} method returns a promise, so a caller is entitled
 * to catch its failures with `.catch()`. A provider whose body is synchronous
 * would otherwise throw before returning that promise, and validation failures
 * would escape every such caller. Providers wrap their synchronous bodies here
 * rather than each remembering to be `async`.
 * @param body - The synchronous body.
 * @returns its value, or a rejection carrying whatever it threw.
 */
export function promised<T>(body: () => T): Promise<T> {
  // The executor turns a throwing body into a rejection with the thrown value
  // intact, without the wrapper having to name or re-tag the failure.
  return new Promise<T>((resolve) => {
    resolve(body())
  })
}
