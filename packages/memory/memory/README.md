---
description: "The learned-memory service: how deployments and plugin authors record evidence-bound lessons and read them back in later sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

`dsh-memory` defines `ctx.memory`: durable lessons an agent records in one session and inherits in later ones. It says what a memory store does, not how it stores — a deployment mounts `dsh-memory-domain` for lessons that outlive the process, or `dsh-memory-ephemeral` for lessons that should not. The seam owns the two rules that make an accumulated store trustworthy rather than merely large: every lesson cites the session events that produced it, and every lesson's standing decays unless later evidence confirms it. It owns no prompt assembly, no sweep schedule, and no model-facing tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

This package stores nothing on its own. A composition mounts one provider, and plugin authors call `ctx.memory` directly.

### When to choose it

Choose learned memory when the same agent works a workspace repeatedly and would otherwise rediscover the same facts every session — a convention the repository enforces, a command that behaves unexpectedly, an assumption that proved wrong. You do not need it for one-shot deployments whose sessions share no subject, and it is the wrong tool for anything the repository already records: code, git history, and written docs are cheaper to read than to remember.

### Smallest working composition

Mount a provider, the sweep that fades unconfirmed lessons, and the digest that carries the survivors into a later prompt:

```yaml
- name: '@deepseek-ai/dsh-memory-domain'
  config:
    halfLifeMs: 2592000000
    dormantFloor: 0.25
    retireFloor: 0.05
- name: '@deepseek-ai/dsh-memory-decay'
  config:
    sweepIntervalMs: 21600000
    sweepOnStart: true
- name: '@deepseek-ai/dsh-memory-prompt'
  config:
    maxLessons: 8
    maxChars: 2000
```

### Recording and reading

Every write cites the session events behind it; a call citing nothing is rejected before anything is stored.

```text
const lesson = await ctx.memory.record({
  scope: session.header.cwd,
  title: 'Run the workspace formatter before committing',
  body: 'The pre-commit hook rejects tabs; the repository formatter fixes them.',
  evidence: [{ session: session.id, seq: [41, 47] }],
  tags: ['build'],
})

const found = await ctx.memory.recall({ text: 'formatter', limit: 5 })
```

<a id="understand-the-implementation"></a>
## Understand the implementation

`MemoryService` is abstract: a provider subclasses it, implements every member, and registers as `ctx.memory`. Every method reports failure by rejecting rather than throwing before it returns, so a caller may rely on `.catch()`; a provider with a synchronous body wraps it in the exported `promised` helper instead of remembering to be `async`.

Selection, scoring, and restatement are pure functions this package owns, not provider code. `scoreLesson` weights a lesson at `confirmations - 2 * contradictions + 1` and halves that every `halfLifeMs` since its last confirmation; `selectRecall` and `selectDigest` filter and rank over any lesson collection. Two providers therefore cannot disagree about what a lesson is worth or which lessons a digest shows, and the arithmetic is testable without a store.

The evidence rule lives in `assertEvidence`, shared the same way: a citation must name at least one event and list sequence numbers in strictly ascending order, so a reader can replay it against the session log without guessing.

The decay policy is owned here too: `DecayParams` is the shape every provider's `Config` aliases, and `resolveDecayParams` is where a `retireFloor` above `dormantFloor` is refused. A provider states its medium and repeats only the schema literal its own config catalog entry is generated from.

<a id="further-exploration"></a>
## Further Exploration

- [Learned memory subsystem](../../../docs/subsystems/memory.md) — the type surface, the decay model, and the generated `ctx.memory` API.
- [`dsh-memory-domain`](../memory-domain/README.md) — the durable provider.
- [`dsh-memory-ephemeral`](../memory-ephemeral/README.md) — the in-process provider.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the digest and tool consumers, which render stored lessons to the model.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the learned-memory service is incomplete on its own. They are current package constraints, not a task backlog.

- **The package stores nothing.** Without a provider mounted, `ctx.memory` is absent and every consumer fails to load.
- **Citations are checked for form, not for existence.** A citation naming events that were never appended is well-formed and accepted; the mismatch is visible only when a reader replays it.
- **Ranking is lexical.** Recall matches substrings and tags, so a lesson phrased differently from the query is not found. Semantic recall would be a second provider, not a change here.

<a id="dev-note"></a>
### Dev Note

The split between `score.ts`/`store.ts` (pure, medium-independent) and the providers (medium adapters) is load-bearing: it is what lets a second provider exist without duplicating judgement. Keep new selection or scoring behavior in this package, and keep providers to reading and writing their medium.

No runtime invariant companion is published: this package is a Service Definition — abstract members, pure scoring, and validation helpers. It owns no store and appends no session events, so the evidence and decay rules are enforced by the provider that owns the records.
