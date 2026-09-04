---
description: "习得记忆衰减清扫：部署方如何调度让无人重新确认的教训淡出的那一遍处理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-decay

[English](README.md) | 中文

## 概述

`dsh-memory-decay` 按间隔运行 `ctx.memory.reclassify()`，使无人重新确认的教训按计划淡出，而不是只在恰好有其他调用触及存储时才变化。它只拥有重新分类*何时*运行：算术、半衰期与两条状态下限全都存放在记忆服务上，因此提示词摘要绝不可能按照清扫并未采用的参数来排序。清扫失败会记录日志并在下一个间隔重试，而不会拆毁宿主——衰减是维护性处理，而非正确性屏障。

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

在任何长生命周期宿主中，与记忆提供方一同挂载它。

### 何时选择

凡是挂载了摘要、且宿主运行足够久以致教训会变旧的场合都应选择它——交互式会话、服务端。短暂的一次性进程可以省略它：运行期间不会有任何内容变旧，而持久化存储会由下一个挂载清扫的宿主完成重新分类。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-memory-decay'
  config:
    sweepIntervalMs: 21600000
    sweepOnStart: true
```

`sweepOnStart` 对持久化存储很重要：在没有宿主运行时教训仍在变旧，因此新进程的第一次清扫，正是移除那些在夜间淡出的教训的时机。

<a id="understand-the-implementation"></a>
## 理解实现

间隔定时器是 unref 的，因此维护性清扫绝不会让进程保持存活；它由 `ctx.effect` 析构器清除，因此随拥有它的 fiber 一同消亡。

被拒绝的清扫会被捕获并记录。下一个间隔会对同样的记录重试，且不会有教训停留在重试无法到达的半重新分类状态——重新分类是从已存字段重新计算状态，而非逐步推进状态转换。

<a id="further-exploration"></a>
## 进一步探索

- [习得记忆子系统](../../../docs/subsystems/memory.zh.md) —— 本清扫所应用的衰减模型。
- [`dsh-memory`](../memory/README.zh.md) —— 半衰期与下限的配置位置。

<a id="model-experience"></a>
## 模型体验

Indirectly, through the digest, whose contents change as lessons fade.

#### KV 缓存影响

无直接失效；清扫引起的任何请求前缀变化由摘要拥有。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该清扫何时并不适用。它们是当前的包约束，而非任务待办。

- **清扫是无条件的。** 每个间隔都会扫描全部已存教训，无论自上次处理以来是否有变化。
- **间隔按墙钟而非工作量计。** 闲置一天的宿主照样按计划清扫；一小时内记录了一百条教训的宿主，也和其他宿主一样等待下一个间隔。
- **宿主之间没有协调。** 共用一个持久化存储的两个宿主各自独立清扫，可能在同一时间窗内重新分类同一批记录。

<a id="dev-note"></a>
### 开发备注

把参数放在服务上而非此处是有意为之：一次以不同半衰期配置的清扫，会静默产生顺序与其自身状态字段相矛盾的摘要。
