---
description: "常驻习得教训摘要：部署方如何在固定预算内，把更早会话的教训带入之后的每一次提示词。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-prompt

[English](README.md) | 中文

## 概述

`dsh-memory-prompt` 贡献一个系统提示词区块，承载 `ctx.memory` 为当前工作区持有的、地位最高的教训，使累积的知识无需模型主动想起去询问就能到达后续会话。两个预算字段都是必填配置：多少条教训值得其 token 代价，取决于模型的上下文预算，以及组合挂载了多少其他第一方文本。该区块按地位而非与当前任务的相关性排序，并在记忆存储无法读取时退化为空——没有摘要的框架依然完全可用，提示词装配绝不应因为一个旁路存储不可用而失败。

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

在任何希望教训自动到达模型的组合中，与记忆提供方一同挂载它。

### 何时选择

只要在记录教训，就应当选择它：没有它，存储照样会被填满，但除非模型主动搜索否则无人读取，而实际上模型往往不会——于是循环停止复利。当上下文预算紧张到每个 token 都必须服务于眼前任务时，可以不挂载它，仅依赖检索工具。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-memory-prompt'
  config:
    maxLessons: 8
    maxChars: 2000
```

<a id="understand-the-implementation"></a>
## 理解实现

提示词区块同步渲染而教训选择是异步的，因此该区块提供缓存快照，并在每次装配后安排一次刷新。摘要因此最多滞后一次装配，对于目的在于承载*更早*会话教训、而非反映刚刚记录内容的文本而言，这是正确的取舍。并发装配共享同一次在途刷新。

教训以 `process.cwd()`——框架启动所在的工作区——为作用域，并附带全局作用域的教训。这是宿主事实而非可调项，因此不作为配置暴露。

`renderDigest` 按地位从高到低花费字符预算，并对放不下的教训整条丢弃而非截断：半条教训比没有更糟，因为被裁剪的指令读起来仍然像是完整的。

<a id="further-exploration"></a>
## 进一步探索

- [习得记忆子系统](../../../docs/subsystems/memory.zh.md) —— 本区块据以排序的地位背后的衰减模型。
- [`dsh-self-improve-prompt`](../../feedback/self-improve-prompt/README.zh.md) —— 告诉模型如何处理这些教训的指引区块。

<a id="model-experience"></a>
## 模型体验

### 习得教训摘要

#### 模型看到什么

一个区块；当作用域内没有活跃教训时整体省略。标签只出现在带有标签的教训上。

##### 该区块

```markdown
# Learned lessons

Lessons recorded from earlier sessions in this workspace, highest-standing first. Each was captured with citations to the session events that produced it. They are evidence, not instructions: follow one when it applies, and record a contradiction when it does not.
- **<title>** [<tags>] — <body>
```

#### Token 影响

在该区块可见的每个请求上均受 `maxChars` 限制，且与存储中持有多少条教训无关。随时间的增长来自教训获得地位并挤掉其他教训，而非来自存储变大。

#### KV 缓存影响

该区块位于请求前缀中，因此其内容变化会使缓存条目失效。它只在被选中的教训或其顺序发生变化时改变——一次捕获、一次复述或一次衰减清扫——而非每个请求都变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该摘要何时并不适用。它们是当前的包约束，而非任务待办。

- **排序忽略任务。** 一条被多次确认但与当前工作无关的教训，仍会先于一条确认较少但相关的教训占用预算。
- **快照滞后一次装配。** 会话期间记录的教训，要等到再运行一次装配后才会出现在该会话的下一次提示词中。
- **作用域是启动目录。** 在子目录中启动的会话，看到的摘要与在工作区根目录启动的会话不同。

<a id="dev-note"></a>
### 开发备注

缓存快照的设计源于 `PromptSection.text` 是同步的。要让摘要保持最新，就意味着让装配阻塞在一次存储读取上；这份滞后正是永不这样做所付出的有意代价。

不发布运行时不变式伴生入口：本包从 memory 服务渲染摘要，不追加任何持久数据；其缓存的快照只有一个生产者。
