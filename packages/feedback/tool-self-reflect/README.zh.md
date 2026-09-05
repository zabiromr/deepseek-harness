---
description: "教训捕获工具：部署方如何让智能体记录未来会话应当知道的内容，并针对新证据复述某条教训。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-self-reflect

[English](README.md) | 中文

## 概述

`dsh-tool-self-reflect` 注册 `tool-self-reflect`，即习得记忆能力缝的写入侧。模型可以记录一条后续会话本来必须重新发现的教训、确认一条再次被证实的教训，或反驳一条误导过它的教训。每次调用都必须引用支持它的会话事件：没有引用的调用会在存储任何内容之前被拒绝，因为无人能够回放到会话日志上的教训绝不应重新进入提示词。凡是挂载了 `ctx.memory` 的地方都可挂载它；没有记忆提供方时该插件不会加载。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与记忆提供方一同挂载它，通常还要挂载把已记录教训带入后续会话的摘要。

### 何时选择

当同一个智能体反复回到同一个工作区、并应当跨会话累积知识时选择它。会话之间毫无共同主题、或没有任何组件读取存储时不要挂载它——只捕获而不检索纯属成本。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-tool-self-reflect'
  config:
    allowGlobalScope: true
    maxBodyChars: 1000
```

`allowGlobalScope: false` 会把每条教训都钉死在记录会话所在的工作区，这适合单个智能体处理互不相关项目的部署：在一个仓库中学到的教训不会浮现到另一个仓库。

### 每次调用做什么

`record` 存储一条新教训。`confirm` 提升既有教训的地位并重置其衰减时钟。`contradict` 降低其地位，在默认策略下会立即使其退役。三者都要求证据；`confirm` 与 `contradict` 还需要检索工具和摘要都会报告的教训 id。

<a id="understand-the-implementation"></a>
## 理解实现

该工具解析两件模型不必重复说明的事。每条引用默认指向调用方智能体的会话，因此模型只需给出事件序号；教训作用域默认取该会话的工作目录，因此教训会落在它被学到的工作区。没有归属智能体的调用因此必须显式给出这两者，否则会被拒绝。

其余一切都属于能力缝。校验、评分与存储归 `ctx.memory` 所有；本包只是把模型参数翻译成服务调用，并把由此得到的地位渲染回去。

<a id="further-exploration"></a>
## 进一步探索

- [习得记忆子系统](../../../docs/subsystems/memory.zh.md) —— 本工具所供给的证据规则与衰减模型。
- [`dsh-tool-knowledge-base`](../tool-knowledge-base/README.zh.md) —— 读取侧。
- [`dsh-self-improve-prompt`](../self-improve-prompt/README.zh.md) —— 告诉模型何时值得记录一条教训的指引。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`tool-self-reflect` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-self-reflect)：必填的 `action`，取值 `record`、`confirm` 或 `contradict`；必填的 `evidence` 数组，元素为 `{ session?, seq }` 引用；以及各动作所需的可选 `title`、`body`、`lesson_id`、`scope` 与 `tags`。描述文本说明了证据要求以及每个动作的用途。

#### Token 影响

在该工具可见的每个请求上都是固定的 schema 开销；描述与 schema 不随配置变化。

#### KV 缓存影响

只要定义与可见性不变即保持前缀稳定。插件生命周期或作用域限制可能使基于该 schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

成功时返回一行：`lesson <id> (<status>): <title> — <n> confirmed, <m> contradicted`，使模型能够确认捕获已落地，以及该教训当前的地位。失败信息来自记忆服务本身：无引用的调用、缺少标题或正文的 `record`、超过 `maxBodyChars` 的正文、部署所禁止的全局作用域、没有教训 id 的复述，以及未知的教训 id。

#### Token 影响

增长几乎完全来自模型写下的教训文本，它会作为调用参数留在会话记录中；结果本身很小且形状固定。

#### KV 缓存影响

仅追加；新出现的内容位于可复用的请求前缀之后，不会使既有 KV 缓存条目失效。一条被记录的教训可能改变后续请求前缀中的摘要区块。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了捕获工具何时并不适用。它们是当前的包约束，而非任务待办。

- **引用未经核验。** 该工具检查引用格式良好且递增，但不检查所指事件是否存在，因此伪造的引用会被存储，只有在有人读取时才会被发现。
- **没有任何机制促使捕获发生。** 该工具只在模型调用时记录；从不反思的会话，无论学到了什么都不会留下任何内容。
- **不能编辑或删除。** 措辞糟糕的教训只能被反驳，而无法修正或移除。

<a id="dev-note"></a>
### 开发备注

证据参数在 schema 层面即为必填，而非仅在函数体中校验，因此模型在组织调用之前读 schema 就能看到这项义务。请保持如此：遵守该规则比事后补救容易得多。

不发布运行时不变式伴生入口：本工具通过拥有记录的 memory 服务写入教训，包内不保留可供比对的第二份副本。
