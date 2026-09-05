---
description: "The in-process learned-memory provider: how deployments and tests get a working memory store whose lessons die with the host."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-ephemeral

English | [中文](README.zh.md)

## Summary

`dsh-memory-ephemeral` implements `ctx.memory` in a plain `Map`, so lessons exist for the life of the host and are gone when it exits. It exists for the cases where durability is wrong rather than merely absent: schema generation and tests, which must not touch a real store, and sandboxed or short-lived deployments where a lesson recorded by one run must not reach the next. Selection, scoring, and restatement all come from `dsh-memory`, so this provider and the durable one cannot disagree about what a lesson is worth. Mount `dsh-memory-domain` instead wherever learned memory is supposed to accumulate.

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

Mount it anywhere a memory consumer must load without a storage backend present. It requires no other service.

### When to choose it

Choose it when lessons must not persist: a sandbox running untrusted work, a test that needs a real service rather than a stand-in, or a catalog generator that must boot a tool without writing to disk. It is also the honest choice for a deployment that wants reflection within a long session but no cross-session inheritance. Do not choose it when the point is compounding knowledge — nothing survives the process.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-memory-ephemeral'
  config:
    halfLifeMs: 2592000000
    dormantFloor: 0.25
    retireFloor: 0.05
```

The decay parameters mean the same thing here as in the durable provider, so a deployment that swaps providers keeps its policy. `retireFloor` above `dormantFloor` is rejected at load, because it would make `dormant` unreachable.

<a id="understand-the-implementation"></a>
## Understand the implementation

The whole store is one `Map<LessonId, Lesson>` owned by the service instance. Every method body is synchronous and wrapped in the seam's `promised` helper, so a validation failure reaches the caller as a rejection rather than a synchronous throw — the same contract the durable provider offers.

Because the records never reach a medium, this package registers no runtime invariant: the evidence rule it upholds is enforced by the seam's shared validation, whose failures are ordinary rejections rather than a silent bad write. The durable provider, whose medium can outlive a bad write, carries that check instead.

<a id="further-exploration"></a>
## Further Exploration

- [Learned memory subsystem](../../../docs/subsystems/memory.md) — the decay model and the generated `ctx.memory` API.
- [`dsh-memory-domain`](../memory-domain/README.md) — the durable provider.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the digest and tool consumers, which render stored lessons to the model.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the in-process provider is a poor fit. They are current package constraints, not a task backlog.

- **Nothing survives the host.** A restart loses every lesson, so the always-on digest starts empty in each new process.
- **Lessons are not shared.** Two hosts on one machine keep separate stores, and nothing reconciles them.
- **Memory is unbounded.** The Map has no cap, so a long-running host that records continuously grows until it exits.

<a id="dev-note"></a>
### Dev Note

This provider is what lets a tool package be tested and its schema generated against the real seam rather than a hand-written stand-in. Keep it behaviourally identical to the durable provider — any divergence would make those tests prove the wrong thing.

No runtime invariant companion is published: this provider's store is private in-process state with no independent event or second data source; checking it would re-run the implementation it claims to verify.
