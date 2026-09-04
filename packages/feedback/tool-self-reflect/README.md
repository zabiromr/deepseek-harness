---
description: "The lesson-capture tool: how a deployment lets an agent record what a future session should know, and restate a lesson against new evidence."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-self-reflect

English | [中文](README.zh.md)

## Summary

`dsh-tool-self-reflect` registers `tool-self-reflect`, the write side of the learned-memory seam. The model records a lesson a later session would otherwise have to rediscover, confirms a lesson that proved right again, or contradicts one that misled it. Every call must cite the session events that justify it: an uncited call is rejected before anything is stored, because a lesson nobody can replay against the session log must never re-enter a prompt. Mount it wherever `ctx.memory` is mounted; without a memory provider the plugin does not load.

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

Mount it with a memory provider and, normally, the digest that carries recorded lessons into later sessions.

### When to choose it

Choose it when the same agent returns to the same workspace and should accumulate knowledge across sessions. Leave it out when sessions share no subject, or when nothing reads the store — capture without recall is pure cost.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-tool-self-reflect'
  config:
    allowGlobalScope: true
    maxBodyChars: 1000
```

`allowGlobalScope: false` pins every lesson to the recording session's workspace, which suits a deployment whose one agent works unrelated projects: a lesson learned in one repository then cannot surface in another.

### What each call does

`record` stores a new lesson. `confirm` raises an existing lesson's standing and resets its decay clock. `contradict` lowers its standing and, in the default policy, retires it at once. All three require evidence; `confirm` and `contradict` also require the lesson id the recall tool and the digest both report.

<a id="understand-the-implementation"></a>
## Understand the implementation

The tool resolves two things the model should not have to repeat. Each citation defaults to the calling agent's session, so the model names only event sequence numbers; and the lesson scope defaults to that session's working directory, so lessons land in the workspace they were learned in. A call with no owning agent must therefore state both explicitly, and is rejected when it does not.

Everything else is the seam's. Validation, scoring, and storage belong to `ctx.memory`; this package translates model arguments into a service call and renders the resulting standing back.

<a id="further-exploration"></a>
## Further Exploration

- [Learned memory subsystem](../../../docs/subsystems/memory.md) — the evidence rule and decay model this tool feeds.
- [`dsh-tool-knowledge-base`](../tool-knowledge-base/README.md) — the read side.
- [`dsh-self-improve-prompt`](../self-improve-prompt/README.md) — the guidance telling the model when a lesson is worth recording.

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`tool-self-reflect` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-self-reflect): a required `action` of `record`, `confirm`, or `contradict`; a required `evidence` array of `{ session?, seq }` citations; and the optional `title`, `body`, `lesson_id`, `scope`, and `tags` each action needs. The description states the evidence requirement and what each action is for.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema do not vary with configuration.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Success returns one line: `lesson <id> (<status>): <title> — <n> confirmed, <m> contradicted`, so the model can tell that a capture landed and what standing the lesson now has. Failures are the memory service's own: an uncited call, a `record` missing its title or body, a body over `maxBodyChars`, a global scope a deployment forbids, a restatement without a lesson id, and an unknown lesson id.

#### Token effect

Growth comes almost entirely from the lesson text the model writes, which stays in the transcript as call arguments; the result itself is small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries. A recorded lesson can change the digest section in a later request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the capture tool is a poor fit. They are current package constraints, not a task backlog.

- **Citations are not verified.** The tool checks that citations are well-formed and ascending, not that the named events exist, so a fabricated citation is stored and only detected when someone reads it.
- **Nothing prompts a capture.** The tool records when the model calls it; a session that never reflects contributes nothing, whatever it learned.
- **No edit or delete.** A badly worded lesson can only be contradicted, not corrected or removed.

<a id="dev-note"></a>
### Dev Note

The evidence argument is required at the schema level rather than validated only in the body, so a model reading the schema sees the obligation before it composes a call. Keep it that way: the rule is easier to follow than to recover from.
