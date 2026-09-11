/**
 * Audit the citations behind stored lessons.
 *
 * `tool-self-reflect` refuses a citation that does not resolve or names no
 * event a turn produced, but no check on a citation can decide whether those
 * events support the claim. This reads a learned-memory store against the
 * session logs it points at and reports what each lesson actually cites, so
 * the part a validator cannot judge is at least visible: a lesson citing one
 * tool call and its result is evidence, and one citing every sequence number
 * in its session is not, though both satisfy every rule the tool enforces.
 *
 * Run: `pnpm run audit-memory-citations [--home <dsh home>]`
 * Exits non-zero when a lesson is unresolvable or cites no work.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createZstdFrameDecoder, scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session/chunk-rows'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Event types a turn produces by acting, mirroring the rule the capture tool enforces. */
const WORK_TYPES: ReadonlySet<string> = new Set(['assistant/message', 'tool/call', 'tool/result'])

/**
 * Citation width past which an evenly spaced run says nothing about selection.
 * A precise citation of the same size survives, because it steps unevenly:
 * a real one pairs calls with their results and skips what happened between.
 */
const BLANKET_CITATION = 8

/** One lesson as stored, reduced to what an audit needs. */
interface StoredLesson {
  readonly title: string
  readonly body: string
  readonly status: string
  readonly confirmations: number
  readonly contradictions: number
  readonly evidence: readonly { readonly session: string; readonly seq: readonly number[] }[]
}

/** What the audit concluded about one lesson. */
interface Finding {
  readonly title: string
  readonly status: string
  readonly confirmations: number
  readonly contradictions: number
  readonly cited: number
  readonly work: number
  readonly unresolved: number
  readonly blanket: boolean
  /** Same body text as another stored lesson: one of them is redundant. */
  readonly duplicated: boolean
}

/**
 * Read one session log into its events, expanding packed chunk rows.
 *
 * The container concatenates Zstandard frames and packs delta runs into single
 * storage rows, so both codecs are required: a reader that decompresses only
 * the first frame, or that treats a packed row as one event, sees a fraction
 * of the log and reports absent sequence numbers that are present.
 * @param path - session log file.
 * @returns every event by sequence number.
 */
function readSessionEvents(path: string): Map<number, SessionEvent> {
  const buffer = readFileSync(path)
  const decoder = createZstdFrameDecoder()
  const events = new Map<number, SessionEvent>()
  try {
    for (const plain of decoder.decode(buffer, scanZstdFrames(buffer).frames)) {
      for (const line of plain.toString('utf8').split('\n')) {
        if (line.trim() === '') continue
        let value: unknown
        try {
          value = JSON.parse(line)
        } catch {
          // A torn final line: the container appends, so a partial tail is expected.
          continue
        }
        for (const event of decodeStorageRecord(value)) events.set(event.seq, event)
      }
    }
  } finally {
    decoder.close()
  }
  return events
}

/**
 * Decide whether a citation covers a run wide enough to guarantee a hit.
 * A contiguous or evenly strided sweep names events without selecting any.
 * @param seq - cited sequence numbers in one citation.
 * @returns true when the citation reads as a sweep rather than a selection.
 */
function isBlanket(seq: readonly number[]): boolean {
  if (seq.length < BLANKET_CITATION) return false
  const steps = new Set<number>()
  for (let index = 1; index < seq.length; index += 1) {
    const previous = seq[index - 1]
    const current = seq[index]
    if (previous === undefined || current === undefined) return false
    steps.add(current - previous)
  }
  return steps.size === 1
}

/**
 * Audit every lesson in one store.
 * @param home - DSH home holding `storages/memory` and `sessions`.
 * @returns one finding per lesson, in stored order.
 */
export function auditCitations(home: string): Finding[] {
  const lessonDir = join(home, 'storages', 'memory', 'lessons')
  const sessionRoot = join(home, 'sessions')
  if (!existsSync(lessonDir)) return []

  const logs = new Map<string, Map<number, SessionEvent> | undefined>()
  const locate = (id: string): Map<number, SessionEvent> | undefined => {
    if (logs.has(id)) return logs.get(id)
    let found: Map<number, SessionEvent> | undefined
    for (const project of readdirSync(sessionRoot, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const path = join(sessionRoot, project.name, id, 'session.jsonl.zstd')
      if (existsSync(path)) { found = readSessionEvents(path); break }
    }
    logs.set(id, found)
    return found
  }

  const names = readdirSync(lessonDir).filter(name => name.endsWith('.json'))
  const bodies = new Map<string, number>()
  for (const name of names) {
    const { record } = JSON.parse(readFileSync(join(lessonDir, name), 'utf8')) as { record: StoredLesson }
    bodies.set(record.body, (bodies.get(record.body) ?? 0) + 1)
  }

  return names.map((name) => {
    const stored = JSON.parse(readFileSync(join(lessonDir, name), 'utf8')) as { record: StoredLesson }
    const lesson = stored.record
    let cited = 0
    let work = 0
    let unresolved = 0
    let blanket = false
    for (const citation of lesson.evidence) {
      const events = locate(citation.session)
      blanket = blanket || isBlanket(citation.seq)
      for (const seq of citation.seq) {
        cited += 1
        const event = events?.get(seq)
        if (event === undefined) { unresolved += 1; continue }
        if (WORK_TYPES.has(event.type)) work += 1
      }
    }
    return {
      title: lesson.title,
      status: lesson.status,
      confirmations: lesson.confirmations,
      contradictions: lesson.contradictions,
      cited,
      work,
      unresolved,
      blanket,
      duplicated: (bodies.get(lesson.body) ?? 0) > 1,
    }
  })
}

/**
 * Report one store and exit non-zero when a lesson cannot be replayed.
 * @param home - DSH home to audit.
 * @returns process exit code.
 */
export function reportCitations(home: string): number {
  const findings = auditCitations(home)
  if (findings.length === 0) {
    console.log(`audit-memory-citations: no lessons under ${home}`)
    return 0
  }
  console.log(`audit-memory-citations: ${findings.length} lesson(s) under ${home}\n`)
  console.log('status    +/-   work  cited  unres  title')
  for (const f of findings) {
    const mark = f.unresolved > 0 || f.work === 0 ? '!' : f.blanket ? '~' : f.duplicated ? '=' : ' '
    const standing = `${f.confirmations}/${f.contradictions}`
    console.log(
      `${f.status.padEnd(9)}${standing.padStart(4)}${String(f.work).padStart(7)}`
      + `${String(f.cited).padStart(7)}${String(f.unresolved).padStart(7)}  ${mark} ${f.title.slice(0, 52)}`,
    )
  }
  const broken = findings.filter(f => f.unresolved > 0 || f.work === 0)
  const swept = findings.filter(f => f.blanket && f.unresolved === 0 && f.work > 0)
  // A retired lesson leaves the digest without saying so anywhere a reader
  // looks, so a contradiction that retired a sound lesson stays invisible
  // until someone opens the store. Both are reported rather than judged.
  const retired = findings.filter(f => f.status !== 'active')
  const duplicated = findings.filter(f => f.duplicated)
  console.log('')
  if (retired.length > 0) {
    console.log(`- ${retired.length} lesson(s) no longer reach the digest:`)
    for (const f of retired) {
      console.log(`    ${f.status} after ${f.contradictions} contradiction(s): ${f.title.slice(0, 56)}`)
    }
  }
  if (duplicated.length > 0) {
    console.log(`= ${duplicated.length} lesson(s) share a body with another: the digest pays for each copy.`)
  }
  if (swept.length > 0) {
    console.log(`~ ${swept.length} lesson(s) cite a contiguous or strided sweep: the rules pass, the citation selects nothing.`)
  }
  if (broken.length === 0) {
    console.log('every lesson resolves and names work.')
    return 0
  }
  console.log(`! ${broken.length} lesson(s) cannot be replayed as evidence.`)
  return 1
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? '')) {
  const flag = process.argv.indexOf('--home')
  process.exitCode = reportCitations(flag === -1 ? join(homedir(), '.dsh') : process.argv[flag + 1] ?? join(homedir(), '.dsh'))
}
