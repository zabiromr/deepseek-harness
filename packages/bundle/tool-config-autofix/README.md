---
description: "Auto-fix configuration issues. A placeholder tool registration in the self-improvement plugin family, for maintainers choosing, configuring, or debugging it."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-config-autofix

English | [中文](README.zh.md)

## Summary

`dsh-tool-config-autofix` registers one model-facing tool, `tool-config-autofix`, whose stated purpose is to auto-fix configuration issues. It is a placeholder registration: the tool takes a single free-form `action` string, ignores it, and always returns `{ "status": "ok" }`. Nothing is stored, analysed, or returned to the agent. Mount it only to reserve the tool name and its wire shape while configuration repair is still being designed, and leave it out wherever an agent is expected to act on the result.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package when a composition should already expose the `tool-config-autofix` name — so prompts, catalogs, and downstream tooling can be written against a stable shape — while the behaviour behind that name is still being designed.

### When to choose it

Choose it to reserve the tool name together with its argument and result shape. Avoid it in any deployment whose behaviour depends on the tool doing something: every call succeeds and reports `ok`, so an agent cannot tell a working implementation from this one. A composition that needs real configuration repair should leave this row out until the implementation lands.

### Minimal configuration

`enabled` is required and has no default: a composition that omits it fails to load, and a non-boolean value is rejected. The flag gates whether the row mounts; it does not change what the tool does, because the tool does nothing either way.

```yaml
- id: tool-config-autofix
  name: '@deepseek-ai/dsh-tool-config-autofix'
  config:
    enabled: true
```

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`tool-config-autofix` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-config-autofix): an object with one required `action` string documented only as `Action.`, and a result object carrying a required `status` string. The tool description is the fixed sentence `Auto-fix configuration issues.`

#### Token effect

A fixed schema cost on every request where the tool is visible. The description and parameter schema are constant, so the cost does not vary with configuration.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Every call returns exactly `{ "status": "ok" }`, rendered as the single line `Auto-fix configuration issues. done`. There is no failure path and no variation: the `action` argument never changes the result, and nothing the model sends is retained beyond the call arguments already in the transcript.

#### Token effect

The `action` string the model writes stays in the transcript as call arguments, while the result is small and fixed-shape. Growth therefore comes almost entirely from what the model chose to write.

#### KV Cache effect

Append-only; the fixed result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is a poor fit. They are current package constraints, not a task backlog.

- **The tool does nothing.** `execute` ignores its arguments and resolves `{ status: 'ok' }`. There is no configuration repair behind the name.
- **The `action` argument is unvalidated.** It is required and typed `string`, but no vocabulary is defined, so every value is accepted and none carries meaning.
- **Nothing is persisted.** The package appends no session events and owns no store, so no result survives the call. Its invariant companion reserves the package name and registers no durable checks.
- **Success is indistinguishable from absence.** Because every call reports `ok`, an agent cannot detect that the capability is missing, which can mislead a model into believing its work was recorded.

<a id="dev-note"></a>
### Dev Note

The package is deliberately a registration shell: `src/index.ts` holds the Schemastery `Config`, the `defineTool` call, and nothing else. When real behaviour lands it should arrive together with a defined `action` vocabulary and a result that can express failure, because the current always-`ok` contract is the part callers will have written against. Keep the tool name stable across that change — reserving the name is what this package exists to do.
