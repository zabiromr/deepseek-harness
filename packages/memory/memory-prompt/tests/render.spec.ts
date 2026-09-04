/**
 * Digest rendering and its character budget.
 */

import { describe, expect, it } from 'vitest'
import { DIGEST_HEADING, DIGEST_PREAMBLE, renderDigest, renderLesson } from '../src/render.ts'
import type { Lesson, LessonId } from '@deepseek-ai/dsh-memory'
import type { SessionId } from '@deepseek-ai/dsh-session'

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'a' as LessonId,
    scope: '/repo',
    title: 'Run the formatter',
    body: 'The repository formatter rejects tabs.',
    evidence: [{ session: 's1' as SessionId, seq: [3] }],
    tags: [],
    createdAt: 0,
    lastConfirmedAt: 0,
    confirmations: 0,
    contradictions: 0,
    status: 'active',
    ...overrides,
  }
}

describe('renderLesson', () => {
  it('renders title and body on one line', () => {
    expect(renderLesson(lesson())).toBe('- **Run the formatter** — The repository formatter rejects tabs.')
  })

  it('includes tags when the lesson carries them', () => {
    expect(renderLesson(lesson({ tags: ['build', 'ci'] }))).toContain('[build, ci]')
  })
})

describe('renderDigest', () => {
  it('renders nothing when there are no lessons, so the section stays absent', () => {
    expect(renderDigest([], 1000)).toBe('')
  })

  it('carries the heading and preamble once', () => {
    const text = renderDigest([lesson()], 1000)
    expect(text.startsWith(DIGEST_HEADING)).toBe(true)
    expect(text.split(DIGEST_HEADING)).toHaveLength(2)
  })

  it('renders every lesson that fits', () => {
    const text = renderDigest([lesson({ id: 'a' as LessonId }), lesson({ id: 'b' as LessonId, title: 'Second' })], 1000)
    expect(text).toContain('Run the formatter')
    expect(text).toContain('Second')
  })

  it('drops a lesson that does not fit whole rather than clipping it', () => {
    const long = lesson({ title: 'x'.repeat(400) })
    const text = renderDigest([lesson(), long], 400)
    expect(text).toContain('Run the formatter')
    expect(text).not.toContain('xxx')
  })

  it('keeps a later lesson that still fits after a larger one was skipped', () => {
    const huge = lesson({ id: 'huge' as LessonId, title: 'H'.repeat(300) })
    const small = lesson({ id: 'small' as LessonId, title: 'Small' })
    const text = renderDigest([huge, small], 400)
    expect(text).toContain('Small')
  })

  it('renders nothing when the budget cannot even hold the heading', () => {
    expect(renderDigest([lesson()], 10)).toBe('')
  })

  it('renders nothing when the heading fits but no lesson does', () => {
    const headerLength = `${DIGEST_HEADING}

${DIGEST_PREAMBLE}
`.length
    expect(renderDigest([lesson({ title: 'y'.repeat(200) })], headerLength + 5)).toBe('')
  })

  it('stays within the budget', () => {
    const lessons = Array.from({ length: 20 }, (_, index) => lesson({ id: String(index) as LessonId }))
    expect(renderDigest(lessons, 600).length).toBeLessThanOrEqual(600)
  })
})
