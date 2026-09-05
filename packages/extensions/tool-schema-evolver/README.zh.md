---
description: "基于使用数据自动调整工具 schema。自我改进插件族中的占位工具注册，供选择、配置或排查该包的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-schema-evolver

[English](README.md) | 中文

## 概述

`dsh-tool-schema-evolver` 注册一个面向模型的工具 `tool-schema-evolver`，其声明用途是：基于使用数据自动调整工具 schema。它是一个占位注册：该工具接受单个自由格式的 `action` 字符串，忽略其内容，并始终返回 `{ "status": "ok" }`。它不存储、不分析任何内容，也不向 agent 返回任何结果。只有在schema 调优仍处于设计阶段、需要先占住工具名及其协议形状时才挂载它；凡是期望 agent 依据结果采取行动的场景，都不要加入这一行。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当某个组合需要提前暴露 `tool-schema-evolver` 这个名字——以便提示词、目录与下游工具可以针对稳定形状编写——而该名字背后的行为仍在设计中时，挂载本包。

### 何时选择

选择它是为了同时占住工具名及其参数与结果形状。在任何行为依赖该工具真正做事的部署中都应避免：每次调用都会成功并报告 `ok`，因此 agent 无法区分真实实现与本实现。需要真实schema 调优的组合，应在实现落地之前不加入这一行。

### 最小配置

`enabled` 为必填且没有默认值：省略它的组合会加载失败，非布尔值会被拒绝。该开关只决定这一行是否挂载，并不改变工具的行为——因为无论如何工具都不做任何事。

```yaml
- id: tool-schema-evolver
  name: '@deepseek-ai/dsh-tool-schema-evolver'
  config:
    enabled: true
```

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`tool-schema-evolver` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-schema-evolver)：一个对象，含一个必填的 `action` 字符串（文档仅写作 `Action.`），以及一个携带必填 `status` 字符串的结果对象。工具描述是固定的一句话 `Automatically tune tool schemas based on usage data.`

#### Token 影响

只要工具可见，每次请求都产生固定的 schema 开销。描述与参数 schema 恒定，因此该开销不随配置变化。

#### KV 缓存影响

在定义与可见性不变时保持前缀稳定。插件生命周期或作用域限制可能使基于该 schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

每次调用都恰好返回 `{ "status": "ok" }`，渲染为单行 `Automatically tune tool schemas based on usage data. done`。不存在失败路径，也没有任何差异：`action` 参数从不改变结果，模型发送的内容除了已在对话记录中的调用参数之外不会被保留。

#### Token 影响

模型写下的 `action` 字符串会作为调用参数留在对话记录中，而结果很小且形状固定。因此增长几乎完全来自模型自己写下的内容。

#### KV 缓存影响

仅追加；固定结果位于可复用的请求前缀之后，不会使已有的 KV 缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本包在什么情况下并不适用。它们是当前的包约束，而不是任务待办列表。

- **该工具不做任何事。** `execute` 忽略参数并 resolve `{ status: 'ok' }`。这个名字背后没有任何schema 调优。
- **`action` 参数未经校验。** 它必填且类型为 `string`，但没有定义任何取值词表，因此所有值都被接受，也都不具备含义。
- **不做任何持久化。** 本包不追加会话事件、也不拥有存储，因此没有结果能在调用之后留存。它的 invariant 伴生插件只占用包名，不注册任何持久化校验。
- **成功与缺失无法区分。** 由于每次调用都报告 `ok`，agent 无法察觉该能力其实并不存在，这可能误导模型以为它的工作已被记录。

<a id="dev-note"></a>
### 开发备注

本包刻意保持为注册外壳：`src/index.ts` 只包含 Schemastery 的 `Config`、`defineTool` 调用，别无其他。真实行为落地时，应同时给出明确的 `action` 取值词表，以及一个能够表达失败的结果，因为当前"永远返回 `ok`"的契约正是调用方会依赖的部分。在该变更中请保持工具名稳定——占住这个名字正是本包存在的意义。

不发布运行时不变式伴生入口：本预留包只注册一个结果固定的工具，没有可校验的可变状态或事件协议。
