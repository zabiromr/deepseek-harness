---
description: "Anthropic Claude (Opus) example overlay for the headless profile."
kind: "example"
---

# Anthropic Claude (Opus) Example

English | [中文](README.zh.md)

## Summary

This example overlay configures `@deepseek-ai/dsh-llm-pi-ai` with an `anthropic` provider route serving Claude Opus 4.5 and Haiku 4.5. Apply it over the shipped headless profile to route model requests through Anthropic instead of DeepSeek.

## Use

```sh
dsh --profile headless --patch apps/cli/config/examples/anthropic/cordis.yml "task"
```

The `llm-pi-ai` plugin registers an `anthropic` route under its `providers` dict. The `agent-spine` patch retargets the `main` agent to use `provider: anthropic` and `model: claude-opus-4-5`.

## Configuration

The overlay declares two models:

| Model | Context Window | Max Output | Reasoning |
|---|---|---|---|
| `claude-opus-4-5` | 200,000 | 8,192 | off, high |
| `claude-haiku-4-5` | 200,000 | 8,192 | off, high |

Required environment variable: `ANTHROPIC_API_KEY`.

### MAX Subscription Override

For Anthropic MAX (offline desktop subscription), replace `baseURL` and `api`:

```yaml
anthropic:
  apiKeyEnv: ANTHROPIC_API_KEY
  baseURL: http://localhost:11434
  api: openai-completions
  models:
    - id: claude-opus-4-5
      contextWindow: 200000
      maxTokens: 8192
```

## Model Experience

### Token effect

Provider tokenization governs exact input. Thinking tokens (if enabled) are counted in output usage when the provider does not report them separately.

### KV Cache effect

Reasoning content appended to history does not invalidate earlier reusable prefix. Switching from `deepseek-official` to `anthropic` breaks cache at the first message boundary.

## Known Limitations and Deferred Work

- **One wire protocol per route** — the `anthropic` route uses `anthropic-messages` API by default; set `api: openai-completions` for MAX or OpenAI-compatible gateways.
- **A modality declaration is not verified** — models declaring `image` input may be refused by the provider after prompt admission.
- **`GenerateOptions.stop` is unsupported** — pi-ai's common stream options cannot guarantee stop-sequence behavior across providers.
