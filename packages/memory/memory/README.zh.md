---
description: "习得记忆服务：部署方与插件作者如何记录带证据的教训，并在后续会话中读回。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

`dsh-memory` 定义 `ctx.memory`：智能体在一次会话中记录、并在后续会话中继承的持久教训。它规定记忆存储做什么，而非如何存储——部署方挂载 `dsh-memory-domain` 以获得比进程更长寿的教训，或挂载 `dsh-memory-ephemeral` 以获得不应长寿的教训。该能力缝拥有使累积存储可信而非仅仅庞大的两条规则：每条教训都引用产生它的会话事件，且每条教训的地位都会衰减，除非后续证据予以确认。它不拥有提示词装配、清扫调度或任何面向模型的工具。

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

本包自身不存储任何内容。组合需挂载一个提供方，插件作者则直接调用 `ctx.memory`。

### 何时选择

当同一个智能体反复在某个工作区中工作，否则每次会话都要重新发现同样的事实时——仓库强制的某项约定、行为异常的某条命令、被证伪的某个假设——就该选择习得记忆。会话之间毫无共同主题的一次性部署不需要它；对于仓库本身已经记录的内容它也是错误的工具：代码、git 历史与已写成文的文档，读取的代价低于记忆。

### 最小可用组合

挂载一个提供方、让未确认教训淡出的清扫，以及把幸存者带入后续提示词的摘要：

```yaml
- name: '@deepseek-ai/dsh-memory-domain'
  config:
    halfLifeMs: 2592000000
    dormantFloor: 0.25
    retireFloor: 0.05
- name: '@deepseek-ai/dsh-memory-decay'
  config:
    sweepIntervalMs: 21600000
    sweepOnStart: true
- name: '@deepseek-ai/dsh-memory-prompt'
  config:
    maxLessons: 8
    maxChars: 2000
```

### 记录与读取

每次写入都引用其背后的会话事件；没有任何引用的调用会在存储之前被拒绝。

```text
const lesson = await ctx.memory.record({
  scope: session.header.cwd,
  title: 'Run the workspace formatter before committing',
  body: 'The pre-commit hook rejects tabs; the repository formatter fixes them.',
  evidence: [{ session: session.id, seq: [41, 47] }],
  tags: ['build'],
})

const found = await ctx.memory.recall({ text: 'formatter', limit: 5 })
```

<a id="understand-the-implementation"></a>
## 理解实现

`MemoryService` 是抽象类：提供方继承它、实现每个成员，并注册为 `ctx.memory`。每个方法都以拒绝（reject）而非在返回前抛出的方式报告失败，因此调用方可以依赖 `.catch()`；同步实现的提供方用导出的 `promised` 辅助函数包装其函数体，而不必逐个记得写 `async`。

选择、评分与复述都是本包拥有的纯函数，而非提供方代码。`scoreLesson` 将教训权重计为 `confirmations - 2 * contradictions + 1`，并按自上次确认起每 `halfLifeMs` 减半；`selectRecall` 与 `selectDigest` 在任意教训集合上过滤与排序。因此两个提供方不可能在一条教训价值几何、或摘要展示哪些教训上产生分歧，而这套算术无需存储即可测试。

证据规则存放在 `assertEvidence` 中，同样共享：一条引用必须指明至少一个事件，并以严格递增的顺序列出序号，使读者无需猜测即可将其回放到会话日志上。

衰减策略同样归属于此：`DecayParams` 是每个 provider 的 `Config` 所别名的形状，`resolveDecayParams` 则是拒绝 `retireFloor` 高于 `dormantFloor` 的地方。provider 只声明自己的介质，并仅重复用于生成其自身配置目录条目的 schema 字面量。

<a id="further-exploration"></a>
## 进一步探索

- [习得记忆子系统](../../../docs/subsystems/memory.zh.md) —— 类型面、衰减模型，以及生成的 `ctx.memory` API。
- [`dsh-memory-domain`](../memory-domain/README.zh.md) —— 持久化提供方。
- [`dsh-memory-ephemeral`](../memory-ephemeral/README.zh.md) —— 进程内提供方。

<a id="model-experience"></a>
## 模型体验

Indirectly, through the digest and tool consumers, which render stored lessons to the model.

#### KV 缓存影响

无直接失效；上述消费方拥有任何请求前缀变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了习得记忆服务何时自身并不完整。它们是当前的包约束，而非任务待办。

- **本包不存储任何内容。** 未挂载提供方时 `ctx.memory` 不存在，每个消费方都会加载失败。
- **引用只检查形式，不检查存在性。** 指向从未追加过的事件的引用在形式上合法并被接受；只有读者回放时才会发现不一致。
- **排序是词法的。** 检索按子串与标签匹配，因此措辞与查询不同的教训不会被找到。语义检索应是第二个提供方，而非对此处的改动。

<a id="dev-note"></a>
### 开发备注

`score.ts`/`store.ts`（纯粹、与介质无关）与提供方（介质适配器）之间的划分是承重的：正是它让第二个提供方无需复制判断逻辑即可存在。新的选择或评分行为应留在本包，提供方则只负责读写各自的介质。
