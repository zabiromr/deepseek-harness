---
description: "feedback 包组：关于会话与 assistant 消息的用户反馈，供用户与维护者选择、组合或排查反馈采集。"
kind: "package-group"
---

# feedback/：记录的人类反馈

[English](README.md) | 中文

## 概述

feedback 组涵盖对 harness 工作成果的两类互不相关的判断。人类反馈收集对输出的意见：用户通过 `/feedback` 命令提交一条关于整个会话的自由文本评价，产品界面通过 `messageFeedback` 服务读取和修改逐消息评分。两者都不会到达模型——它们是关于输出的信号，绝不是输入，且会话评价与逐消息评分互不影响。智能体反馈则是模型自身的：记录本次会话教训、针对新证据复述教训、搜索更早会话所记录内容的那些工具，以及关于何时值得为其花费一轮的提示词指引。这三个包是 `ctx.memory` 的消费方；持久化存储、证据规则与衰减模型全都位于 [`memory/`](../memory/README.zh.md)。本页是组的映射；包 README 与[反馈子系统页](../../docs/subsystems/feedback.zh.md)负责各自的包级约定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`command-feedback`](command-feedback/README.zh.md) | 一条命令即可记录自由文本会话评价的 `/feedback` 命令，无需模型轮次 |
| [`message-feedback`](message-feedback/README.zh.md) | 逐消息评分与备注，通过 `messageFeedback` 服务提供给产品界面 |
| [`tool-self-reflect`](tool-self-reflect/README.zh.md) | 面向模型的工具，用于记录一条教训，或针对新证据复述一条教训 |
| [`tool-knowledge-base`](tool-knowledge-base/README.zh.md) | 面向模型的工具，用于搜索提示词摘要未承载的已记录教训 |
| [`self-improve-prompt`](self-improve-prompt/README.zh.md) | 关于何时值得记录、复述或搜索教训的提示词指引 |

会话评价是单向信号：在对话的任何时刻记录它都是安全的，且绝不会改变模型看到的内容。在 feedback-gated 共享策略下，记录会话评价正是释放会话共享的动作。

逐消息评分与备注与会话一起保存，重启后依然存在，并且绝不会出现在模型历史或遥测中。

<a id="related-documentation"></a>
## 相关文档

- [反馈子系统](../../docs/subsystems/feedback.zh.md)——message-feedback 的类型、服务契约与 Web 消费方。
- [习得记忆子系统](../../docs/subsystems/memory.zh.md)——三个自我改进包背后的教训词汇、证据规则与衰减模型。
- [会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)——`/feedback` 确认文本披露的共享策略。
- [匿名用户身份](../identity/README.zh.md)——嵌入反馈确认文本的按 harness home 共享 id。

<a id="dev-note"></a>
## 开发备注

无。
