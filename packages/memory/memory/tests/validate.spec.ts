/**
 * The evidence rule: what a lesson must cite before it can be stored, and the
 * request fields whose absence makes a capture meaningless.
 */

import { describe, expect, it } from 'vitest'
import { MemoryError } from '../src/runtime.ts'
import { assertEvidence, assertLimit, assertRecordRequest } from '../src/validate.ts'
import type { LessonEvidence, RecordLessonRequest } from '../src/types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

function citation(seq: readonly number[]): LessonEvidence {
  return { session: 's1' as SessionId, seq }
}

function request(overrides: Partial<RecordLessonRequest> = {}): RecordLessonRequest {
  return {
    scope: '/repo',
    title: 'Prefer the workspace formatter',
    body: 'The repository formatter rejects tabs; run it before committing.',
    evidence: [citation([3, 7])],
    ...overrides,
  }
}

/**
 * Assert a call fails with one documented memory code.
 * @param run - The failing call.
 * @param code - Expected error code.
 */
function expectCode(run: () => void, code: string): void {
  expect(run).toThrow(MemoryError)
  try {
    run()
    expect.unreachable('call should have thrown')
  } catch (error) {
    expect((error as MemoryError).code).toBe(code)
  }
}

describe('assertEvidence', () => {
  it('accepts one ascending citation', () => {
    expect(() => { assertEvidence([citation([1, 2, 9])]) }).not.toThrow()
  })

  it('rejects an empty citation list, because an uncitable lesson cannot be audited', () => {
    expectCode(() => { assertEvidence([]) }, 'missing-evidence')
  })

  it('rejects a citation naming no events', () => {
    expectCode(() => { assertEvidence([citation([])]) }, 'invalid-evidence')
  })

  it('rejects a repeated sequence number', () => {
    expectCode(() => { assertEvidence([citation([4, 4])]) }, 'invalid-evidence')
  })

  it('rejects descending sequence numbers', () => {
    expectCode(() => { assertEvidence([citation([9, 2])]) }, 'invalid-evidence')
  })

  it('rejects a negative sequence number', () => {
    expectCode(() => { assertEvidence([citation([-1])]) }, 'invalid-evidence')
  })

  it('rejects a fractional sequence number', () => {
    expectCode(() => { assertEvidence([citation([1.5])]) }, 'invalid-evidence')
  })

  it('checks every citation, not only the first', () => {
    expectCode(() => { assertEvidence([citation([1]), citation([])]) }, 'invalid-evidence')
  })
})

describe('assertRecordRequest', () => {
  it('accepts a complete request', () => {
    expect(() => { assertRecordRequest(request()) }).not.toThrow()
  })

  it('rejects a blank title', () => {
    expectCode(() => { assertRecordRequest(request({ title: '   ' })) }, 'invalid-request')
  })

  it('rejects a blank body', () => {
    expectCode(() => { assertRecordRequest(request({ body: '' })) }, 'invalid-request')
  })

  it('rejects a blank scope', () => {
    expectCode(() => { assertRecordRequest(request({ scope: ' ' })) }, 'invalid-request')
  })

  it('still enforces the evidence rule', () => {
    expectCode(() => { assertRecordRequest(request({ evidence: [] })) }, 'missing-evidence')
  })
})

describe('assertLimit', () => {
  it('accepts a positive integer', () => {
    expect(() => { assertLimit(5, 'limit') }).not.toThrow()
  })

  it('rejects zero', () => {
    expectCode(() => { assertLimit(0, 'limit') }, 'invalid-request')
  })

  it('rejects a negative limit', () => {
    expectCode(() => { assertLimit(-3, 'limit') }, 'invalid-request')
  })

  it('rejects a fractional limit', () => {
    expectCode(() => { assertLimit(2.5, 'limit') }, 'invalid-request')
  })

  it('names the offending field so the caller can tell which cap failed', () => {
    expect(() => { assertLimit(0, 'digest maxLessons') }).toThrow(/digest maxLessons/)
  })
})
