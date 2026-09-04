/**
 * The durable schemas: what the medium accepts back, independent of the
 * service that normally writes it. A hand-edited or partially written record
 * reaches these schemas without ever passing the service boundary.
 */

import { describe, expect, it } from 'vitest'
import { lessonEvidenceSchema, lessonSchema, lessonStatusSchema, memoryDomainSpec } from '../src/spec.ts'

const CITATION = { session: 's1', seq: [1, 4, 9] }

const LESSON = {
  id: 'lesson-1',
  scope: '/repo',
  title: 'Run the formatter',
  body: 'The repository formatter rejects tabs.',
  evidence: [CITATION],
  tags: ['build'],
  createdAt: 10,
  lastConfirmedAt: 20,
  confirmations: 1,
  contradictions: 0,
  status: 'active',
}

describe('the domain declaration', () => {
  it('stores each lesson as its own document, so one bad record cannot fail the store open', () => {
    expect(memoryDomainSpec.layout).toBe('per-record')
  })
})

describe('lessonStatusSchema', () => {
  it('accepts each documented standing', () => {
    for (const status of ['active', 'dormant', 'retired']) {
      expect(lessonStatusSchema.safeParse(status).success).toBe(true)
    }
  })

  it('rejects an unknown standing', () => {
    expect(lessonStatusSchema.safeParse('archived').success).toBe(false)
  })
})

describe('lessonEvidenceSchema', () => {
  it('accepts an ascending citation', () => {
    expect(lessonEvidenceSchema.safeParse(CITATION).success).toBe(true)
  })

  it('rejects a citation naming no events', () => {
    expect(lessonEvidenceSchema.safeParse({ session: 's1', seq: [] }).success).toBe(false)
  })

  it('rejects a descending citation read back from the medium', () => {
    expect(lessonEvidenceSchema.safeParse({ session: 's1', seq: [9, 2] }).success).toBe(false)
  })

  it('rejects a repeated sequence number', () => {
    expect(lessonEvidenceSchema.safeParse({ session: 's1', seq: [3, 3] }).success).toBe(false)
  })

  it('rejects a citation with no session', () => {
    expect(lessonEvidenceSchema.safeParse({ session: '', seq: [1] }).success).toBe(false)
  })
})

describe('lessonSchema', () => {
  it('accepts a well-formed lesson', () => {
    expect(lessonSchema.safeParse(LESSON).success).toBe(true)
  })

  it('rejects a lesson that lost its citations', () => {
    expect(lessonSchema.safeParse({ ...LESSON, evidence: [] }).success).toBe(false)
  })

  it('rejects a lesson confirmed before it was created', () => {
    expect(lessonSchema.safeParse({ ...LESSON, createdAt: 50, lastConfirmedAt: 10 }).success).toBe(false)
  })

  it('rejects a lesson with no title', () => {
    expect(lessonSchema.safeParse({ ...LESSON, title: '' }).success).toBe(false)
  })

  it('rejects a lesson with an unknown standing', () => {
    expect(lessonSchema.safeParse({ ...LESSON, status: 'archived' }).success).toBe(false)
  })
})
