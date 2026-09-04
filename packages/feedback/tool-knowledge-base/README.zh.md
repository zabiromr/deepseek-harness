---
description: "教训检索工具：部署方如何让智能体搜索常驻摘要无法展示的过往教训。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-knowledge-base

[English](README.md) | 中文

## 概述

`dsh-tool-knowledge-base` 注册 `tool-knowledge-base`，即习得记忆能力缝的读取侧。提示词摘要已经承载了地位最高的活跃教训，因此本工具面向摘要无法服务的场景：按主题搜索、在依据某条教训行动之前查看其背后的证据，以及触达那些已从摘要中衰减出去但可能仍然适用的教训。结果携带各自的引用，因此模型可以对照产生它的会话日志核验一条教训。凡是挂载了 `ctx.memory` 的地方都可挂载它；没有记忆提供方时该插件不会加载。

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

与记忆提供方一同挂载它，通常还与摘要和捕获工具并列。

### 何时选择

当存储所持有的内容超出摘要所能承载时选择它——教训一旦累积起来，这就是常态。摘要预算充裕且教训不多的部署可以省略它、仅依赖摘要；代价是已淡出的教训及其证据对模型不可达。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-tool-knowledge-base'
  config:
    maxResults: 20
    allowCrossWorkspace: false
```

`allowCrossWorkspace: false` 会把每条结果都钉在调用会话所在的工作区，外加全局作用域的教训。设为 true 则允许一个智能体搜索它曾经记录过的所有工作区，这适合单用户框架，而在工作区必须彼此隔离的场合则是错误的。

<a id="understand-the-implementation"></a>
## 理解实现

该工具从调用方智能体的会话推导工作区，而非信任某个参数，因此跨工作区搜索是部署决定而非模型决定。会话未指明工作目录的调用会回退到全局作用域，那是它唯一能安全声称的作用域。

`maxResults` 是上限而非默认值：模型要求更多时得到上限，要求更少时得到它所要求的数量。该工具是只读的，并被归类为可并行，因此多次搜索可以与其他工作重叠进行。

<a id="further-exploration"></a>
## 进一步探索

- [习得记忆子系统](../../../docs/subsystems/memory.zh.md) —— 本工具报告的各种地位及其含义。
- [`dsh-tool-self-reflect`](../tool-self-reflect/README.zh.md) —— 写入侧，也是改变教训地位的唯一途径。
- [`dsh-memory-prompt`](../../memory/memory-prompt/README.zh.md) —— 与本工具互补的常驻摘要。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`tool-knowledge-base` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-knowledge-base)：可选的 `text`、`tags`、`statuses`（`active`、`dormant`、`retired`）与 `limit`。所有字段均为可选，因此不带参数的调用会按地位列出教训。描述文本说明摘要已经承载了地位最高的教训，并指出哪些情形值得进行一次搜索。

#### Token 影响

在该工具可见的每个请求上都是固定的 schema 开销；描述与 schema 不随配置变化。

#### KV 缓存影响

只要定义与可见性不变即保持前缀稳定。插件生命周期或作用域限制可能使基于该 schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

有匹配时，每条教训渲染为 `- [<status>] <title> (<id>)`，正文位于下一行；其中的 id 正是捕获工具确认或反驳它所需要的。无匹配时精确渲染为 `No matching lessons.`。结构化结果还额外携带每条教训的标签、计数与引用。

#### Token 影响

增长随匹配教训的数量与体量而变化，并受 `maxResults` 限制。宽泛的或不带参数的查询是代价最高的情形。

#### KV 缓存影响

仅追加；新出现的内容位于可复用的请求前缀之后，不会使既有 KV 缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了检索工具何时并不适用。它们是当前的包约束，而非任务待办。

- **匹配是词法的。** 搜索比较子串与标签，因此措辞与查询不同的教训无论多么相关都不会被找到。
- **结果按地位而非匹配质量排序。** 一条匹配较弱但确认充分的教训，会排在一条高度匹配但较新的教训之前。
- **证据是被返回而非被解析的。** 该工具报告引用；读取被引用的事件需要会话查询工具。

<a id="dev-note"></a>
### 开发备注

工作区作用域从调用方推导而非作为参数接受，是有意为之。把它做成参数将允许模型把自己的触达范围扩大到部署配置之外。
