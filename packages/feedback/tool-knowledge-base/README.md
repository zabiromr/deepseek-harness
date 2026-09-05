---
description: "The lesson-recall tool: how a deployment lets an agent search past lessons the always-on digest cannot show."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-knowledge-base

English | [中文](README.zh.md)

## Summary

`dsh-tool-knowledge-base` registers `tool-knowledge-base`, the read side of the learned-memory seam. The prompt digest already carries the highest-standing active lessons, so this tool exists for what the digest cannot serve: searching by topic, reading the evidence behind a lesson before acting on it, and reaching lessons that have decayed out of the digest but may still apply. Results carry their citations, so the model can check a lesson against the session log that produced it. Mount it wherever `ctx.memory` is mounted; without a memory provider the plugin does not load.

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

Mount it with a memory provider, normally alongside the digest and the capture tool.

### When to choose it

Choose it when the store holds more than a digest can carry — the usual case once lessons accumulate. A deployment with a generous digest budget and few lessons can omit it and rely on the digest alone; the cost is that faded lessons and their evidence become unreachable to the model.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-tool-knowledge-base'
  config:
    maxResults: 20
    allowCrossWorkspace: false
```

`allowCrossWorkspace: false` pins every result to the calling session's workspace plus globally-scoped lessons. Setting it true lets one agent search every workspace it has ever recorded in, which is right for a single-user harness and wrong wherever workspaces must stay separated.

<a id="understand-the-implementation"></a>
## Understand the implementation

The tool derives the workspace from the calling agent's session rather than trusting an argument, so cross-workspace search is a deployment decision and not a model one. A call whose session names no working directory falls back to the global scope, which is the only scope it can safely claim.

`maxResults` is a ceiling, not a default: a model asking for more receives the ceiling, and a model asking for fewer receives what it asked for. The tool is read-only and classifies as parallel-safe, so several searches may overlap with other work.

<a id="further-exploration"></a>
## Further Exploration

- [Learned memory subsystem](../../../docs/subsystems/memory.md) — the standings this tool reports and what they mean.
- [`dsh-tool-self-reflect`](../tool-self-reflect/README.md) — the write side, and the only way to change a lesson's standing.
- [`dsh-memory-prompt`](../../memory/memory-prompt/README.md) — the always-on digest this tool complements.

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`tool-knowledge-base` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-knowledge-base): optional `text`, `tags`, `statuses` (`active`, `dormant`, `retired`), and `limit`. Every field is optional, so an argument-less call lists lessons by standing. The description explains that the digest already carries the top lessons and names the cases worth a search.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema do not vary with configuration.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

A match renders one entry per lesson as `- [<status>] <title> (<id>)` followed by the body on the next line; the id is what the capture tool needs to confirm or contradict it. No match renders exactly `No matching lessons.` The structured result additionally carries each lesson's tags, counts, and citations.

#### Token effect

Growth scales with the number and size of matching lessons, bounded by `maxResults`. A broad or argument-less query is the expensive case.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the recall tool is a poor fit. They are current package constraints, not a task backlog.

- **Matching is lexical.** Search compares substrings and tags, so a lesson phrased differently from the query is not found however relevant it is.
- **Results are ranked by standing, not by match quality.** A weakly matching well-confirmed lesson outranks a closely matching new one.
- **Evidence is returned, not resolved.** The tool reports citations; reading the cited events requires the session-query tools.

<a id="dev-note"></a>
### Dev Note

Workspace scoping is derived from the caller rather than accepted as an argument on purpose. Making it a parameter would let a model widen its own reach past what the deployment configured.

No runtime invariant companion is published: this tool reads and writes through the memory service, which owns the records; the package itself keeps no second copy to compare.
