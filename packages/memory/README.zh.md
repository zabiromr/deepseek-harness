---
description: "习得记忆系列的包地图：seam、两个提供方、摘要与衰减清扫各自提供什么。"
kind: "package-group"
---

# memory/ —— 习得记忆能力系列

[English](README.md) | 中文

## 概述

`memory/` 系列让智能体把一次会话中学到的内容带入之后的会话。一条教训是一段简短、可据以行动的陈述——本项目强制的某项约定、被证伪的某个假设、行为异常的某条命令——并连同指向产生它的会话事件的引用一起存储。有两条规则使不断累积的存储可信而非仅仅庞大，且二者都归属于该 seam 而非某个提供方：每条教训都引用其证据，且每条教训的地位都会衰减，除非后续证据予以确认。本系列拥有存储、选择与提示词摘要；面向模型的捕获与检索工具位于 `feedback/`，而告诉模型何时使用它们的指引位于 `dsh-self-improve-prompt`。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

五个包承担记忆相关角色；子系统参考文档拥有完整的词汇与契约。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.zh.md) | Service Definition：教训词汇、证据规则，以及每个提供方共享的评分与选择函数 | `ctx.memory` |
| [`memory-domain/`](memory-domain/README.zh.md) | 基于 `storage-domain` 域的持久化提供方，使教训比进程更长寿 | 注册到 `ctx.memory` |
| [`memory-ephemeral/`](memory-ephemeral/README.zh.md) | 教训随宿主消亡的进程内提供方——用于测试、schema 生成与沙箱 | 注册到 `ctx.memory` |
| [`memory-prompt/`](memory-prompt/README.zh.md) | 常驻系统提示词摘要，在字符预算内承载地位最高的教训 | 贡献到 `ctx.systemPrompt` |
| [`memory-decay/`](memory-decay/README.zh.md) | 对无人重新确认的教训进行重新分类的定期清扫 | 调用 `ctx.memory` |

一个组合只挂载一个提供方。选择、评分与复述都是该 seam 拥有的纯函数，因此两个提供方不可能在一条教训价值几何上产生分歧；衰减参数存放在服务上，因此摘要绝不可能按照清扫并未采用的半衰期来排序。

-----

<a id="related-documentation"></a>
## 相关文档

先看子系统参考文档了解共享词汇，再看写入与读取该存储的工具。

- [习得记忆子系统](../../docs/subsystems/memory.zh.md) —— `Lesson` 词汇、证据规则、衰减模型，以及生成的 `ctx.memory` API。
- [`dsh-tool-self-reflect`](../feedback/tool-self-reflect/README.zh.md) —— 面向模型的捕获工具。
- [`dsh-tool-knowledge-base`](../feedback/tool-knowledge-base/README.zh.md) —— 面向模型的检索工具。
- [`storage/`](../storage/README.zh.md) —— 持久化提供方借以存储的域数据形态。

<a id="dev-note"></a>
## 开发备注

本系列刻意把判断排除在提供方之外。凡是决定一条教训价值几何、一次查询返回哪些教训、或一次确认做什么的逻辑，都属于 `memory/`；提供方只负责读写自己的介质。正是这一划分，让未来的提供方——比如基于向量的存储——无需重新决定其中任何一项即可存在。
