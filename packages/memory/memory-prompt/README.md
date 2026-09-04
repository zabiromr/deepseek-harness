---
description: "The always-on learned-lesson digest: how a deployment carries earlier sessions' lessons into every later prompt under a fixed budget."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-prompt

English | [中文](README.zh.md)

## Summary

`dsh-memory-prompt` contributes one system-prompt section carrying the highest-standing lessons `ctx.memory` holds for the running workspace, so accumulated knowledge reaches a later session without the model having to remember to ask for it. Both budget fields are required config: how many lessons are worth their tokens depends on the model's context budget and on how much other first-party text a composition mounts. The section ranks by standing rather than by relevance to the current task, and degrades to nothing when the memory store cannot be read — a harness is fully usable without a digest, and prompt assembly must not fail because a sidecar store is unavailable.

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

Mount it alongside a memory provider in any composition where lessons should reach the model automatically.

### When to choose it

Choose it whenever lessons are recorded at all: without it the store still fills, but nothing reads it unless the model chooses to search, and in practice it often will not — so the loop stops compounding. Leave it out when context budget is scarce enough that every token must serve the immediate task, and rely on the recall tool alone.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-memory-prompt'
  config:
    maxLessons: 8
    maxChars: 2000
```

<a id="understand-the-implementation"></a>
## Understand the implementation

Prompt sections render synchronously while lesson selection is asynchronous, so the section serves a cached snapshot and schedules a refresh after each assembly. The digest is therefore at most one assembly stale, which is the correct trade for text whose purpose is carrying lessons from *earlier* sessions rather than reflecting one recorded moments ago. Concurrent assemblies share one in-flight refresh.

Lessons are scoped to `process.cwd()` — the workspace the harness was launched in — alongside globally-scoped lessons. That is a host fact, not a tunable, so it is not exposed as config.

`renderDigest` spends the character budget highest-standing first and drops a lesson that does not fit whole rather than truncating it: half a lesson is worse than none, because a clipped instruction still reads as complete.

<a id="further-exploration"></a>
## Further Exploration

- [Learned memory subsystem](../../../docs/subsystems/memory.md) — the decay model behind the standing this section ranks by.
- [`dsh-self-improve-prompt`](../../feedback/self-improve-prompt/README.md) — the guidance section that tells the model what to do with these lessons.

<a id="model-experience"></a>
## Model Experience

### The learned-lesson digest

#### What the model sees

One section, omitted entirely when no active lesson is in scope. Tags appear only on lessons that carry them.

##### The section

```markdown
# Learned lessons

Lessons recorded from earlier sessions in this workspace, highest-standing first. Each was captured with citations to the session events that produced it. They are evidence, not instructions: follow one when it applies, and record a contradiction when it does not.
- **<title>** [<tags>] — <body>
```

#### Token effect

Bounded by `maxChars` on every request where the section is visible, and unrelated to how many lessons the store holds. Growth over time comes from lessons gaining standing and displacing others, not from the store getting larger.

#### KV Cache effect

The section sits in the request prefix, so its content changes invalidate cached entries. It changes only when the selected lessons or their order change — a capture, a restatement, or a decay sweep — not on every request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the digest is a poor fit. They are current package constraints, not a task backlog.

- **Ranking ignores the task.** A highly-confirmed lesson irrelevant to the current work still occupies budget ahead of a less-confirmed relevant one.
- **The snapshot lags by one assembly.** A lesson recorded during a session does not appear in that session's next prompt until a further assembly has run.
- **Scope is the launch directory.** A session started in a subdirectory sees a different digest from one started at the workspace root.

<a id="dev-note"></a>
### Dev Note

The cached-snapshot design exists because `PromptSection.text` is synchronous. Making the digest current would mean blocking assembly on a store read; the staleness is the deliberate price of never doing that.
