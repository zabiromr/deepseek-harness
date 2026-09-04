---
description: "持久化习得记忆提供方：部署方如何存储比进程更长寿的教训，以及介质在读回时接受什么。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-domain

[English](README.md) | 中文

## 概述

`dsh-memory-domain` 在 `ctx.storage.domain` 之上实现 `ctx.memory`，使记录下来的教训能够跨越重启，并到达同一工作区的下一次会话。它以 `per-record` 布局打开一个 `memory` 域，在持久化边界上用 zod schema 校验每条记录，并从该域的内存状态提供读取，因此读取绝不会绕过写入链。凡是希望习得记忆不断累积的场合都应挂载它；教训不得比进程更长寿的场合则改挂 `dsh-memory-ephemeral`。衰减参数是必填且无默认值的配置：未确认的教训应当多快淡出，取决于该部署运行会话的频率。

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

在任何已挂载 `dsh-storage-domain` 的组合中挂载它；除非部署方显式指定路由，`memory` 域会走该插件的默认后端。

### 何时选择

当教训意在跨会话复利增长时选择它——这是交互式框架数周内持续处理同一个仓库的常规情形。在一次性或多租户沙箱中应避免使用：那里某次运行记录的教训不得到达下一次运行。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-memory-domain'
  config:
    halfLifeMs: 2592000000
    dormantFloor: 0.25
    retireFloor: 0.05
```

在这组取值下，无人重新确认的教训约 60 天后离开提示词摘要，约 130 天后退役；被反驳的教训分数转负，并在下一次清扫时退役。`retireFloor` 高于 `dormantFloor` 会在加载时被拒绝，因为那会使 `dormant` 永不可达。

<a id="understand-the-implementation"></a>
## 理解实现

该服务在 `[Service.init]` 中打开自己的域，并通过 `ctx.effect` 析构器释放它，因此介质随拥有它的 fiber 一同关闭。选择与评分来自 `dsh-memory`；本包只提供表。

`per-record` 布局是有意为之：每条教训各自成为一个文档，因此单条陈旧或畸形的记录会被单独丢弃，而不会导致整个存储打开失败。一个可能在重新加载时让会话瘫痪的记忆，比没有记忆更糟。

证据规则被有意检查两次。`dsh-memory` 在任何写入之前拒绝无引用的请求，而 `src/spec.ts` 在记录从介质读回时拒绝无引用的记录，因为手工编辑或写入不完整的存储可能持有从未经过任何服务调用校验的记录。本包的不变量伴生插件针对同一关系监视持久化写入事件流，因此违规会归因于此处，而不是稍后以畸形摘要的形式浮现。

<a id="further-exploration"></a>
## 进一步探索

- [习得记忆子系统](../../../docs/subsystems/memory.zh.md) —— 衰减模型与生成的 `ctx.memory` API。
- [`dsh-storage-domain`](../../storage/storage-domain/README.zh.md) —— 本提供方借以存储的域数据形态。

<a id="model-experience"></a>
## 模型体验

Indirectly, through the digest and tool consumers, which render stored lessons to the model.

#### KV 缓存影响

无直接失效；上述消费方拥有任何请求前缀变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了持久化提供方何时并不适用。它们是当前的包约束，而非任务待办。

- **存储只增不减。** 退役一条教训绝不会删除它，因此大量记录的部署会无界地累积记录。
- **检索会读取整张表。** 每次调用都会扫描全部已存教训进行过滤与排序，这对数千条没问题，对数百万条则不然。
- **每个宿主一个域。** 教训在单一域内按作用域区分，因此共享同一框架主目录的两个工作区共享介质与版本标记。

<a id="dev-note"></a>
### 开发备注

读取针对该域已加载的状态同步进行，写入走它的单一链路，因此此处不存在锁。新增一个直接触达后端的查询会破坏这一性质；应改为扩展 `dsh-memory` 中共享的选择函数。
