---
description: "进程内习得记忆提供方：部署方与测试如何获得一个教训随宿主消亡的可用记忆存储。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-ephemeral

[English](README.md) | 中文

## 概述

`dsh-memory-ephemeral` 用一个普通的 `Map` 实现 `ctx.memory`，因此教训只在宿主生命周期内存在，宿主退出即消失。它面向的是「持久化本身就是错误」而非「恰好缺席」的场合：schema 生成与测试不得触碰真实存储，以及沙箱化或短生命周期部署中某次运行记录的教训不得到达下一次运行。选择、评分与复述全部来自 `dsh-memory`，因此本提供方与持久化提供方不可能在一条教训价值几何上产生分歧。凡是希望习得记忆不断累积的场合，应改挂 `dsh-memory-domain`。

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

在任何需要让记忆消费方在没有存储后端时也能加载的场合挂载它。它不依赖其他服务。

### 何时选择

当教训不得持久化时选择它：运行不可信工作的沙箱、需要真实服务而非替身的测试，或必须在不写盘的情况下启动某个工具的目录生成器。对于希望在长会话内进行反思、但不需要跨会话继承的部署，它同样是诚实的选择。当目标是知识复利增长时不要选它——没有任何内容能在进程之外存活。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-memory-ephemeral'
  config:
    halfLifeMs: 2592000000
    dormantFloor: 0.25
    retireFloor: 0.05
```

此处的衰减参数与持久化提供方含义相同，因此更换提供方的部署可以保留其策略。`retireFloor` 高于 `dormantFloor` 会在加载时被拒绝，因为那会使 `dormant` 永不可达。

<a id="understand-the-implementation"></a>
## 理解实现

整个存储就是服务实例拥有的一个 `Map<LessonId, Lesson>`。每个方法体都是同步的，并由能力缝的 `promised` 辅助函数包装，因此校验失败以拒绝而非同步抛出的形式到达调用方——与持久化提供方提供的契约一致。

由于记录从不触及介质，本包不注册运行时不变量：它所维护的证据规则由能力缝的共享校验强制执行，其失败是普通的拒绝而非静默的坏写入。介质可能比一次坏写入更长寿的持久化提供方，则承担该检查。

<a id="further-exploration"></a>
## 进一步探索

- [习得记忆子系统](../../../docs/subsystems/memory.zh.md) —— 衰减模型与生成的 `ctx.memory` API。
- [`dsh-memory-domain`](../memory-domain/README.zh.md) —— 持久化提供方。

<a id="model-experience"></a>
## 模型体验

Indirectly, through the digest and tool consumers, which render stored lessons to the model.

#### KV 缓存影响

无直接失效；上述消费方拥有任何请求前缀变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了进程内提供方何时并不适用。它们是当前的包约束，而非任务待办。

- **没有任何内容在宿主之后存活。** 重启会丢失全部教训，因此常驻摘要在每个新进程中都从空开始。
- **教训不共享。** 同一台机器上的两个宿主各自持有独立存储，且没有任何机制进行调和。
- **内存无上限。** 该 Map 没有容量上限，因此持续记录的长运行宿主会一直增长到退出为止。

<a id="dev-note"></a>
### 开发备注

正是本提供方让工具包能够针对真实能力缝而非手写替身来测试并生成其 schema。请保持它与持久化提供方行为一致——任何分歧都会让那些测试证明错误的东西。

不发布运行时不变式伴生入口：本 provider 的存储是进程内私有状态，没有独立事件或第二数据源；校验它等于重跑它声称要验证的实现。
