---
description: "The learned-memory decay sweep: how a deployment schedules the pass that fades lessons nothing re-confirms."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-decay

English | [中文](README.zh.md)

## Summary

`dsh-memory-decay` runs `ctx.memory.reclassify()` on an interval, so a lesson nothing re-confirms fades on a schedule instead of only when some other call happens to touch the store. It owns *when* reclassification runs and nothing else: the arithmetic, the half-life, and the two status floors all live on the memory service, so a prompt digest can never rank by parameters the sweep does not apply. A failing sweep logs and retries on the next interval rather than tearing down the host — decay is a maintenance pass, not a correctness barrier.

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

Mount it alongside a memory provider in any long-lived host.

### When to choose it

Choose it wherever the digest is mounted and the host runs long enough for lessons to age — an interactive session, a server. A short one-shot process can omit it: nothing will have aged within the run, and the durable store is reclassified by the next host that mounts the sweep.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-memory-decay'
  config:
    sweepIntervalMs: 21600000
    sweepOnStart: true
```

`sweepOnStart` matters for a durable store: lessons age while no host is running, so the first sweep of a new process is what removes lessons that faded overnight.

<a id="understand-the-implementation"></a>
## Understand the implementation

The interval timer is unreferenced, so a maintenance sweep never holds the process open, and it is cleared by a `ctx.effect` disposer, so it dies with the fiber that owns it.

A sweep that rejects is caught and logged. The next interval retries against the same records, and no lesson is left in a partially reclassified state that a retry could not reach — reclassification recomputes status from stored fields rather than stepping through transitions.

<a id="further-exploration"></a>
## Further Exploration

- [Learned memory subsystem](../../../docs/subsystems/memory.md) — the decay model this sweep applies.
- [`dsh-memory`](../memory/README.md) — where the half-life and floors are configured.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the digest, whose contents change as lessons fade.

#### KV Cache effect

No direct invalidation; the digest owns any request-prefix changes a sweep causes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the sweep is a poor fit. They are current package constraints, not a task backlog.

- **The sweep is unconditional.** Every interval scans every stored lesson, whether or not anything changed since the last pass.
- **The interval is wall-clock, not workload.** A host idle for a day still sweeps on schedule; a host that records a hundred lessons in an hour waits for the next interval like any other.
- **Nothing coordinates hosts.** Two hosts over one durable store sweep independently and may reclassify the same records in the same window.

<a id="dev-note"></a>
### Dev Note

Keeping the parameters on the service rather than here is deliberate: a sweep configured with a different half-life than the ranking would silently produce a digest whose order contradicts its own status field.

No runtime invariant companion is published: this package is pure arithmetic over records the provider owns; it observes no event stream of its own.
