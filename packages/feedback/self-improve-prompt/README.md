---
description: "System-prompt guidance for learned memory: when a lesson is worth recording, when to restate one, and when to search beyond the digest."
kind: "package-reference"
---

# @deepseek-ai/dsh-self-improve-prompt

English | [中文](README.zh.md)

## Summary

`dsh-self-improve-prompt` contributes one system-prompt section, `self-improvement`, immediately after the learned-lesson digest it explains. Three independent flags mount three pieces of guidance: when a lesson is worth recording, how to confirm or contradict a lesson already in the prompt, and when to search beyond the digest. It registers no tool — it only writes prompt text, so mount each block only where the matching tool is mounted. The text is deliberately about judgement rather than mechanics: the tool schemas already say what the arguments are, and repeating them here would spend prefix tokens on what the model can read anyway.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it alongside the learned-memory tools, with one flag per tool the composition actually offers.

### When to choose it

Choose it wherever capture is mounted: an agent that has the tool but no sense of what deserves recording either never reflects or fills the store with restated task summaries. Turn off any block whose tool is absent, because guidance naming an uncallable tool wastes prefix tokens and invites failed calls.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-self-improve-prompt'
  config:
    showReflectionGuidance: true
    showRestatementGuidance: true
    showRecallGuidance: true
```

Every flag off contributes the empty string, and assembly then omits the section entirely.

<a id="model-experience"></a>
## Model Experience

### Self-improvement prompt section

#### What the model sees

Up to three markdown blocks, in this order, joined by blank lines; each appears only when its flag is on.

##### Recording lessons

```markdown
# Recording lessons

Record a lesson when this session produced knowledge a later session would otherwise have to rediscover: an assumption that turned out wrong, a convention specific to this project, a tool or command that behaved unexpectedly, or a approach that worked after simpler ones failed. Do not record the task you performed, a summary of what you changed, or anything already written in the repository — those are in the log and the code. Every lesson must cite the session events that justify it; a lesson you cannot cite is one you should not record.
```

##### Restating lessons

```markdown
# Restating lessons

The lessons in your prompt are evidence from earlier sessions, not standing orders. When one proves right again, confirm it — confirmation is the only thing that keeps a lesson from fading. When one misleads you, contradict it promptly and cite what actually happened, rather than silently working around it: an uncontradicted wrong lesson keeps costing later sessions.
```

##### Searching past lessons

```markdown
# Searching past lessons

Your prompt carries only the highest-standing lessons for this workspace. Search the full record when you need lessons on a specific topic, the evidence behind one before you act on it, or lessons that have faded but may still apply to unusual work.
```

#### Token effect

A fixed cost per mounted block on every request, independent of how many lessons the store holds.

#### KV Cache effect

Prefix-stable: the text depends only on configuration, so it changes on a config change or plugin lifecycle event and never per request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the section is a poor fit. They are current package constraints, not a task backlog.

- **The text is fixed.** A deployment cannot reword the guidance without forking the package; the flags choose whole blocks, not wording.
- **Flags are not checked against mounted tools.** Enabling a block whose tool is absent is accepted and produces guidance the model cannot act on.
- **Guidance is not enforcement.** Nothing prevents the model from recording task summaries the reflection block tells it to skip.

<a id="dev-note"></a>
### Dev Note

This section previously advertised eleven tool names, nine of which resolved `{ status: 'ok' }` and did nothing. Keep the rule that replaced it: a block ships only when the behaviour behind it does, because an agent told it has a capability it lacks spends turns discovering otherwise.
