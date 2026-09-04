---
description: "Package map for the learned-memory family: what the seam, the two providers, the digest, and the decay sweep each provide."
kind: "package-group"
---

# memory/ — learned-memory capability family

English | [中文](README.zh.md)

## Summary

The `memory/` group lets an agent carry what it learned in one session into later ones. A lesson is a short, actionable statement — a convention this project enforces, an assumption that proved wrong, a command that behaved unexpectedly — stored with citations to the session events that produced it. Two rules keep an accumulating store trustworthy rather than merely large, and both live in the seam rather than in a provider: every lesson cites its evidence, and every lesson's standing decays unless later evidence confirms it. The group owns storage, selection, and the prompt digest; the model-facing capture and recall tools live in `feedback/`, and the guidance telling the model when to use them lives in `dsh-self-improve-prompt`.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Five packages play the memory roles; the subsystem reference owns the exhaustive vocabulary and contracts.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Service Definition: the lesson vocabulary, the evidence rule, and the scoring and selection functions every provider shares | `ctx.memory` |
| [`memory-domain/`](memory-domain/README.md) | Durable provider over a `storage-domain` domain, so lessons outlive the process | registers on `ctx.memory` |
| [`memory-ephemeral/`](memory-ephemeral/README.md) | In-process provider whose lessons die with the host — for tests, schema generation, and sandboxes | registers on `ctx.memory` |
| [`memory-prompt/`](memory-prompt/README.md) | The always-on system-prompt digest carrying the highest-standing lessons under a character budget | contributes to `ctx.systemPrompt` |
| [`memory-decay/`](memory-decay/README.md) | The scheduled sweep that reclassifies lessons nothing re-confirms | calls `ctx.memory` |

A composition mounts exactly one provider. Selection, scoring, and restatement are pure functions the seam owns, so the two providers cannot disagree about what a lesson is worth; decay parameters live on the service, so the digest can never rank by a half-life the sweep does not apply.

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the tools that write and read the store.

- [Learned memory subsystem](../../docs/subsystems/memory.md) — the `Lesson` vocabulary, the evidence rule, the decay model, and the generated `ctx.memory` API.
- [`dsh-tool-self-reflect`](../feedback/tool-self-reflect/README.md) — the model-facing capture tool.
- [`dsh-tool-knowledge-base`](../feedback/tool-knowledge-base/README.md) — the model-facing recall tool.
- [`storage/`](../storage/README.md) — the domain form the durable provider stores through.

<a id="dev-note"></a>
## Dev Note

The group deliberately keeps judgement out of the providers. Anything that decides what a lesson is worth, which lessons a query returns, or what a confirmation does belongs in `memory/`; a provider only reads and writes its medium. That split is what lets a future provider — an embedding-backed store, say — exist without re-deciding any of it.
