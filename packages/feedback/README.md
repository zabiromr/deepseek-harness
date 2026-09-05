---
description: "The feedback package group: user feedback on sessions and assistant messages, for users and maintainers choosing, composing, or debugging feedback capture."
kind: "package-group"
---

# feedback/ — recorded human feedback

English | [中文](README.zh.md)

## Summary

The feedback group covers two unrelated kinds of judgement about the harness's work. Human feedback collects opinions about the output: users submit a free-text remark about a whole session with the `/feedback` command, and product surfaces read and change per-message ratings through the `messageFeedback` service. Neither reaches the model — these are signals about the output, never input to it, and session remarks and per-message ratings do not interact. Agent feedback is the model's own: the tools that record a lesson from this session, restate one against new evidence, and search what earlier sessions recorded, plus the prompt guidance on when each is worth a turn. Those three packages are consumers of `ctx.memory`; the durable store, the evidence rule, and the decay model all live in [`memory/`](../memory/README.md). This page maps the group; the package READMEs and the [feedback subsystem page](../../docs/subsystems/feedback.md) own the per-package contracts.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`command-feedback`](command-feedback/README.md) | A `/feedback` command that records a free-text session remark with one command, without a model turn |
| [`message-feedback`](message-feedback/README.md) | Per-message ratings and notes, served to product surfaces through the `messageFeedback` service |
| [`tool-self-reflect`](tool-self-reflect/README.md) | The model-facing tool that records a lesson, or restates one against new evidence |
| [`tool-knowledge-base`](tool-knowledge-base/README.md) | The model-facing tool that searches recorded lessons the prompt digest does not carry |
| [`self-improve-prompt`](self-improve-prompt/README.md) | Prompt guidance on when a lesson is worth recording, restating, or searching for |

Session remarks are a one-way signal: recording one is safe at any point in a conversation and never changes what the model sees. With a feedback-gated sharing policy, recording a session remark is what releases the session for sharing.

Per-message ratings and notes are stored with the session, survive restarts, and never appear in model history or telemetry.

<a id="related-documentation"></a>
## Related documentation

- [Feedback subsystem](../../docs/subsystems/feedback.md) — the message-feedback types, service contract, and Web consumer.
- [Learned memory subsystem](../../docs/subsystems/memory.md) — the lesson vocabulary, evidence rule, and decay model behind the three self-improvement packages.
- [Session telemetry subsystem](../../docs/subsystems/session-telemetry.md) — the sharing policy disclosed by the `/feedback` acknowledgement.
- [Anonymous user identity](../identity/README.md) — the per-harness-home id embedded in the feedback acknowledgement.

<a id="dev-note"></a>
## Dev Note

None.
