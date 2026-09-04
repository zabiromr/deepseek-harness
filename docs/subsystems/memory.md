# Learned Memory

English | [中文](memory.zh.md)

[`@deepseek-ai/dsh-memory`](../../packages/memory/memory) owns the learned-memory capability seam: durable lessons an agent records from one session and inherits in later ones. Two rules make an accumulated store trustworthy rather than merely large, and both live in the seam rather than in any single provider: every lesson cites the session events that produced it, and every lesson's standing decays unless later evidence confirms it.

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

## Table of Contents

- [Public types](#public-types)
- [The evidence rule](#the-evidence-rule)
- [Standing and decay](#standing-and-decay)
- [What reaches the model](#what-reaches-the-model)
- [Providers](#providers)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Cordis API](#cordis-api)

<a id="public-types"></a>
## Public types

```ts type-equiv
/** Opaque identity of one stored lesson. */
type LessonId = Branded<'LessonId'>
```

```ts type-equiv
/**
 * Scope a lesson applies to: an absolute workspace directory, or
 * {@link GLOBAL_SCOPE} for lessons that hold everywhere. A digest for a
 * workspace draws from that workspace and the global scope, never from a
 * sibling workspace.
 */
type LessonScope = string
```

```ts type-equiv
/**
 * Lifecycle of a stored lesson. Only `active` lessons reach the digest;
 * `dormant` and `retired` remain recallable so a decayed lesson stays
 * auditable rather than vanishing.
 */
type LessonStatus = 'active' | 'dormant' | 'retired'
```

```ts type-equiv
/**
 * One citation backing a lesson: the session that produced the evidence and
 * the sequence numbers of the events within it. A lesson without at least one
 * citation is rejected — an uncitable lesson cannot be audited, so it cannot
 * be trusted enough to re-enter a prompt.
 */
interface LessonEvidence {
  /** Session the cited events belong to. */
  readonly session: SessionId
  /** Sequence numbers of the cited events, ascending and non-empty. */
  readonly seq: readonly number[]
}
```

```ts type-equiv
/** One durable lesson: what to do differently, and the evidence for it. */
interface Lesson {
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
```

```ts type-equiv
/** Request payload capturing a new lesson. */
interface RecordLessonRequest {
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
```

```ts type-equiv
/** Query payload for {@link MemoryService.recall}. */
interface RecallQuery {
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
```

```ts type-equiv
/** Selection payload for the always-on prompt digest. */
interface DigestQuery {
  /** Workspace whose lessons are drawn, alongside {@link GLOBAL_SCOPE}. */
  readonly scope: LessonScope
  /** Maximum lessons returned, highest score first. */
  readonly maxLessons: number
}
```

```ts type-equiv
/** Outcome of one {@link MemoryService.reclassify} pass. */
interface ReclassifySummary {
  /** Lessons that moved from `active` to `dormant`. */
  readonly demoted: number
  /** Lessons that moved to `retired`. */
  readonly retired: number
  /** Lessons whose status was left unchanged. */
  readonly unchanged: number
}
```

```ts type-equiv
/** Decay parameters shared by scoring and reclassification. */
interface DecayParams {
  /** Milliseconds over which an unconfirmed lesson's score halves. */
  readonly halfLifeMs: number
  /** Score at or below which an `active` lesson becomes `dormant`. */
  readonly dormantFloor: number
  /** Score at or below which a lesson becomes `retired`. */
  readonly retireFloor: number
}
```

<a id="the-evidence-rule"></a>
## The evidence rule

`record`, `confirm`, and `contradict` all reject a call that cites nothing. Each citation names a session and the ascending sequence numbers of the events within it, so any reader can replay a lesson against the session log that produced it. This is what lets an accumulated lesson re-enter a prompt: a claim nobody can check is not evidence, and the harness never injects one.

The rule is enforced twice on purpose. The service boundary rejects an uncited request before any write; the durable schema rejects an uncited record on the way back off the medium, because a hand-edited or partially written store can hold records no service call ever validated. The durable provider's invariant companion watches the write stream as well, so a violation is attributed to the package that owns it rather than surfacing later as a malformed digest.

<a id="standing-and-decay"></a>
## Standing and decay

A lesson's score is `confirmations - 2 * contradictions + 1`, halved for every `halfLifeMs` since its last confirmation.

A freshly captured lesson therefore starts at 1 without anyone vouching for it, each independent confirmation adds 1, and each contradiction removes 2. The asymmetry is deliberate: a lesson that has actively misled the agent costs more than an unconfirmed one, so two lukewarm confirmations do not rescue a lesson that was wrong once, and a single contradiction takes a new lesson negative — out of the digest immediately, without waiting for a sweep.

Decay is the only automatic movement. Standing rises solely through `confirm`, which requires new citations and resets the decay clock; a contradiction deliberately does not reset it, or arguing against a stale lesson would freshen it. Nothing infers confirmation from a session merely completing successfully — that signal would reward exactly the lessons vague enough never to be contradicted.

Status follows score against two floors: at or below `dormantFloor` a lesson stops appearing in the digest, and at or below `retireFloor` it retires. Neither status deletes anything. A retired lesson stays recallable, so the record of what was once believed, and the evidence for it, remains auditable.

<a id="what-reaches-the-model"></a>
## What reaches the model

Two paths, with different jobs:

- [`@deepseek-ai/dsh-memory-prompt`](../../packages/memory/memory-prompt) contributes an always-on system-prompt section carrying the highest-standing `active` lessons for the running workspace, under a character budget. It ranks by score, not by relevance to the current task: at assembly time the task is not yet known, so a relevance signal there would be a guess. Prompt sections render synchronously while selection is asynchronous, so the section serves a cached snapshot and refreshes after each assembly — at most one assembly stale, which is correct for text whose purpose is carrying lessons from *earlier* sessions.
- [`@deepseek-ai/dsh-tool-knowledge-base`](../../packages/feedback/tool-knowledge-base) answers queries the digest cannot: search by topic, the evidence behind a lesson, and lessons that have faded out of the digest but may still apply.

[`@deepseek-ai/dsh-tool-self-reflect`](../../packages/feedback/tool-self-reflect) is the write side, and [`@deepseek-ai/dsh-self-improve-prompt`](../../packages/feedback/self-improve-prompt) is the guidance telling the model when capture and restatement are worth a turn.

<a id="providers"></a>
## Providers

| Provider | Medium | Use it for |
|---|---|---|
| [`memory-domain`](../../packages/memory/memory-domain) | A `storage-domain` domain, `per-record` layout | Deployments where lessons must outlive the process. One stale or malformed lesson is discarded on its own instead of failing the store open. |
| [`memory-ephemeral`](../../packages/memory/memory-ephemeral) | An in-process `Map` | Schema generation, tests, and sandboxed or short-lived deployments where lessons should not outlive the process. |

Selection, scoring, and restatement are pure functions owned by the seam, so the two providers cannot disagree about what a lesson is worth or which lessons a digest shows. [`@deepseek-ai/dsh-memory-decay`](../../packages/memory/memory-decay) owns only *when* reclassification runs; the parameters live on the service, so a digest can never rank by a half-life the sweep does not apply.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits define when the capability is a poor fit. They are current constraints, not a task backlog.

- **Recall is substring and tag matching, not semantic search.** A lesson phrased differently from the query is not found. A future embedding-backed provider is a second implementation of this seam, not a change to it.
- **The digest ranks by standing, not by the task at hand.** A highly-confirmed lesson irrelevant to the current work still occupies budget ahead of a less-confirmed relevant one.
- **Citations are not verified at capture time.** The service checks that citations are well-formed and ascending, not that the named events exist; a fabricated citation is detectable on read but not refused on write.
- **Scope is a directory string.** A lesson recorded in a subdirectory of a workspace does not reach sessions started at its root, and moving a workspace strands its lessons.
- **Nothing is ever deleted.** Retired lessons accumulate; a deployment that records prolifically grows its store without bound.

<a id="cordis-api"></a>
## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryservice-abstract-seam"></a>

### `ctx.memory` — `MemoryService` (abstract seam)

Abstract learned-memory service. Subclass, implement every member, and load the subclass as a plugin — it registers as `ctx.memory` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- record REJECTS a request citing no evidence, before any write.
- confirm and contradict require NEW evidence and are the only ways a lesson's standing rises; nothing infers confirmation from a session merely completing.
- recall searches every status by default, so a decayed lesson stays auditable; digest returns only `active` lessons.
- EVERY method reports failure by REJECTING, never by throwing before it returns; a provider with a synchronous body wraps it in `promised`.
- reclassify is pure arithmetic over stored records — it makes no model calls and never deletes a lesson.

```ts cordis-catalog
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
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
