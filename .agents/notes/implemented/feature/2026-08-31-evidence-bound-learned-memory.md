# Agent Note: Evidence-bound learned memory

Status: implemented

English | [中文](2026-08-31-evidence-bound-learned-memory.zh.md)

## Problem

An earlier change reserved eleven `tool-*` package names for a "self-improvement" family — reflection, pattern caching, a knowledge base, session memory, feedback aggregation, plugin and schema evolution, meta-learning, adversarial review, benchmarking, config autofix. Every one of them registered a tool that took a free-form `action` string, ignored it, and resolved `{ status: 'ok' }`. `dsh-self-improve-prompt` advertised all eleven to the model as real capabilities, and the shipped bundles mounted them enabled.

That state is worse than having nothing. A tool that always reports success is indistinguishable from a working one, so a model told it can "capture lessons learned" spends turns believing it did. The names also encoded a taxonomy nobody had validated: reflection, pattern caching, meta-learning, and feedback aggregation are four names for one feedback loop.

The underlying goal was real, though. A harness that works one repository over weeks rediscovers the same facts every session — a convention the project enforces, an assumption that proved wrong, a command that behaves unexpectedly — and none of it is written anywhere a later session reads.

The hard part is not storage. It is trust: a store that accumulates without curation becomes prompt pollution, and a harness that pollutes its own prompt gets worse every session.

## Decision

A learned-memory capability seam, `ctx.memory`, holds durable **lessons**: a one-line statement of what to do differently, a body, and citations into the session log. Two rules make the store trustworthy, and both live in the seam rather than in any provider.

**Every lesson cites its evidence.** `record`, `confirm`, and `contradict` all reject a call that cites nothing, before any write. Each citation names a session and the strictly ascending sequence numbers of the events within it, so a reader can replay a lesson against the log that produced it. A claim nobody can check is not evidence, and the harness never injects one. The rule is enforced at three points on purpose: the service boundary rejects uncited requests, the durable zod schema rejects uncited records read back off the medium, and the `dsh-memory-domain` invariant companion watches the durable write stream so a violation is attributed to the package that owns it.

**Standing decays unless evidence renews it.** A lesson scores `confirmations - 2 * contradictions + 1`, halved for every `halfLifeMs` since its last confirmation. Decay is the only automatic movement; standing rises solely through `confirm`, which requires new citations. Status falls against two floors — below `dormantFloor` a lesson leaves the prompt digest, below `retireFloor` it retires — and nothing is ever deleted, so what was once believed stays auditable.

The package topology:

| Package | Role |
|---|---|
| `memory/memory` | Service Definition: vocabulary, the evidence rule, and the scoring and selection functions every provider shares |
| `memory/memory-domain` | Durable provider over `storage-domain`, `per-record` layout |
| `memory/memory-ephemeral` | In-process provider for tests, schema generation, and sandboxes |
| `memory/memory-prompt` | The always-on budgeted prompt digest |
| `memory/memory-decay` | The scheduled reclassification sweep |
| `feedback/tool-self-reflect` | Model-facing capture: `record`, `confirm`, `contradict` |
| `feedback/tool-knowledge-base` | Model-facing recall across every status |
| `feedback/self-improve-prompt` | Guidance on when each is worth a turn |

Selection, scoring, and restatement are pure functions in the seam (`src/store.ts`, `src/score.ts`), so the two providers cannot disagree about what a lesson is worth. Decay parameters live on the service, so a digest can never rank by a half-life the sweep does not apply. Every service method reports failure by rejecting rather than throwing before it returns; a provider with a synchronous body wraps it in the `promised` helper the seam exports.

Four hollow packages are deleted — `tool-pattern-cache`, `tool-feedback-aggregator`, `tool-meta-learner`, `tool-session-memory` — because they named one loop four times. Five remain as name reservations for later stages (`tool-plugin-evolver`, `tool-schema-evolver`, `tool-config-autofix`, `tool-adversarial-reviewer`, `tool-automated-benchmarker`) and are now `disabled: true` in the shipped bundle: a reserved name must not be offered to the model until behaviour sits behind it. `dsh-self-improve-prompt` was rewritten to describe only what exists.

## Two rules deliberately not adopted

**Implicit confirmation.** It is tempting to treat "the lesson was in the digest and the session went fine" as a confirmation. That is survivorship bias dressed as evidence: it would inflate exactly the lessons vague enough never to be contradicted. Confirmation is explicit only.

**Symmetric weighting.** A contradiction removes 2 while a confirmation adds 1, so two lukewarm confirmations do not rescue a lesson that misled the agent once, and a single contradiction takes a new lesson negative — out of the digest immediately, without waiting for a sweep. Bad memory is more expensive than absent memory.

## Alternatives considered

**A single self-contained plugin over `storage-domain`.** Roughly 40% less code and no seam to maintain. Rejected: it violates the capability-seam convention, and a second store — embedding-backed recall, a shared team store — would have no interface to register against. The later config- and plugin-evolution stages are also intended to consume `ctx.memory` rather than invent their own stores; that only works if the seam exists.

**Deriving memory from the session log alone.** No new persistence: lessons are session events, and recall re-runs `session_query` searches. Attractive because evidence would *be* the storage, so nothing could drift from its source. Rejected because decay requires mutable scores and the session log is append-only by design, and because searching raw logs for lessons is noisy. The adopted split keeps evidence in the log, judgement in the domain, and a pointer from one to the other.

**Human-approved promotion.** Nothing reaches the prompt until a human promotes it. Highest precision, and rejected because the loop then stalls whenever nobody is looking — which defeats the point of a harness that improves across sessions unattended.

**Task-relevance ranking in the digest.** Rejected: at prompt-assembly time the task is not yet known, so any relevance signal there would be a guess. Query-driven relevance is the recall tool's job.

## Consequences

The harness accumulates knowledge across sessions in a workspace, bounded by a configured character budget and self-limiting through decay — no human curation step, and no unbounded prompt growth.

It cost eight packages' worth of surface, each carrying the repository's per-file 100% coverage obligation, plus a bilingual subsystem page and README pair per package. It also cost a deliberate staleness: prompt sections render synchronously while selection is asynchronous, so the digest serves a cached snapshot and is at most one assembly behind.

What it bought beyond the feature itself is a seam the next two stages stand on. Configuration evolution and plugin authoring both need somewhere to record what was tried and whether it helped; they consume `ctx.memory` instead of each inventing a store, and inherit the evidence rule with it.

Recall is lexical — substring and tag matching — so a lesson phrased differently from a query is not found. Citations are checked for form, not existence, so a fabricated citation is stored and detectable only on read. Retired lessons are never deleted, so a prolific deployment grows its store without bound. Each limit is recorded in the owning package README.

## Testing

224 tests across the eight packages, at per-file 100% statement, branch, function, and line coverage. The load-bearing cases: an uncited call is rejected before any write; a lesson recorded through one host is served to a digest built by a second host over the same medium; a contradiction retires a lesson without resetting its decay clock; a confirmation revives a faded one; the digest drops a lesson that does not fit its budget whole rather than clipping it; and the durable provider's invariant fires on an uncited record reaching the write stream.

## Related

- [Learned memory subsystem](../../../../docs/subsystems/memory.md) — the vocabulary, decay model, and generated `ctx.memory` API.
