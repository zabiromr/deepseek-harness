---
description: "面向 headless profile 的 Anthropic Claude（Opus）示例 overlay。"
kind: "example"
---

# Anthropic Claude（Opus）示例

[English](README.md) | 中文

## 概述

该示例 overlay 为 `@deepseek-ai/dsh-llm-pi-ai` 配置一条提供 Claude Opus 4.5 与 Haiku 4.5 的 `anthropic` provider 路由。把它叠加在随附的 headless profile 之上，即可把模型请求路由到 Anthropic 而不是 DeepSeek。

## 使用

```sh
dsh --profile headless --patch apps/cli/config/examples/anthropic/cordis.yml "task"
```

`llm-pi-ai` 插件在其 `providers` 字典下注册一条 `anthropic` 路由。`agent-spine` patch 把 `main` agent 改为使用 `provider: anthropic` 与 `model: claude-opus-4-5`。

## 配置

该 overlay 声明两个模型：

| 模型 | 上下文窗口 | 最大输出 | 推理 |
|---|---|---|---|
| `claude-opus-4-5` | 200,000 | 8,192 | off、high |
| `claude-haiku-4-5` | 200,000 | 8,192 | off、high |

必需的环境变量：`ANTHROPIC_API_KEY`。

### MAX 订阅覆盖

对于 Anthropic MAX（离线桌面订阅），请替换 `baseURL` 与 `api`：

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

## 模型体验

### Token 影响

准确的输入由 provider 的分词方式决定。当 provider 不单独报告思考 token 时（若已启用），它们会计入输出用量。

### KV Cache 影响

追加到历史中的推理内容不会使更早的可复用前缀失效。从 `deepseek-official` 切换到 `anthropic` 会在第一个消息边界处中断缓存。

## 已知限制和延期工作

- **每条路由只有一种 wire 协议** —— `anthropic` 路由默认使用 `anthropic-messages` API；对 MAX 或 OpenAI 兼容网关请设置 `api: openai-completions`。
- **模态声明不会被校验** —— 声明支持 `image` 输入的模型仍可能在提示词被接纳之后被 provider 拒绝。
- **不支持 `GenerateOptions.stop`** —— pi-ai 的通用流式选项无法保证各 provider 之间的停止序列行为。
