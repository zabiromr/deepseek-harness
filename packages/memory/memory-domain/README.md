---
description: "The durable learned-memory provider: how deployments store lessons that outlive the process, and what the medium accepts back."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-domain

English | [中文](README.zh.md)

## Summary

`dsh-memory-domain` implements `ctx.memory` over `ctx.storage.domain`, so recorded lessons survive a restart and reach the next session in the same workspace. It opens one `memory` domain with a `per-record` layout, validates every record against its zod schema at the durable boundary, and serves reads from the domain's in-memory state so a read never goes around the write chain. Mount it wherever learned memory is supposed to accumulate; mount `dsh-memory-ephemeral` instead where lessons must not outlive the process. Decay parameters are required config with no defaults: how fast an unconfirmed lesson should fade depends on how often the deployment runs sessions.

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

Mount it in any composition that already mounts `dsh-storage-domain`; the `memory` domain routes through that plugin's default backend unless a deployment routes it explicitly.

### When to choose it

Choose it when lessons are meant to compound across sessions — the ordinary case for an interactive harness working one repository over weeks. Avoid it in throwaway or multi-tenant sandboxes where a lesson recorded by one run must not reach the next.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-memory-domain'
  config:
    halfLifeMs: 2592000000
    dormantFloor: 0.25
    retireFloor: 0.05
```

With these values a lesson nobody re-confirms leaves the prompt digest after about 60 days and retires after about 130; a contradicted lesson scores negative and retires on the next sweep. `retireFloor` above `dormantFloor` is rejected at load, because it would make `dormant` unreachable.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service opens its domain in `[Service.init]` and releases it through a `ctx.effect` disposer, so the medium is closed with the fiber that owns it. Selection and scoring come from `dsh-memory`; this package supplies only the table.

`per-record` layout is a deliberate choice: each lesson is its own document, so a single stale or malformed record is discarded on its own rather than failing the whole store open. A memory that can brick a session on reload would be worse than no memory.

The evidence rule is checked twice on purpose. `dsh-memory` rejects an uncited request before any write, and `src/spec.ts` rejects an uncited record on the way back off the medium, because a hand-edited or partially written store can hold records no service call ever validated. The package's invariant companion watches the durable write stream for the same relation, so a violation is attributed here rather than surfacing later as a malformed digest.

<a id="further-exploration"></a>
## Further Exploration

- [Learned memory subsystem](../../../docs/subsystems/memory.md) — the decay model and the generated `ctx.memory` API.
- [`dsh-storage-domain`](../../storage/storage-domain/README.md) — the domain form this provider stores through.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the digest and tool consumers, which render stored lessons to the model.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the durable provider is a poor fit. They are current package constraints, not a task backlog.

- **The store only grows.** Retiring a lesson never deletes it, so a deployment that records prolifically accumulates records without bound.
- **Recall reads the whole table.** Filtering and ranking scan every stored lesson on each call, which is fine for thousands and not for millions.
- **One domain per host.** Lessons are separated by scope inside a single domain, so two workspaces sharing a harness home share a medium and a version stamp.

<a id="dev-note"></a>
### Dev Note

Reads are synchronous against the domain's loaded state and writes go through its single chain, so no lock lives here. Adding a query that reaches the backend directly would break that property; extend the shared selection functions in `dsh-memory` instead.
