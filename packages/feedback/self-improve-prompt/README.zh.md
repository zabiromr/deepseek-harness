---
description: "习得记忆的系统提示词指引：何时值得记录一条教训、何时复述一条，以及何时应搜索摘要之外的内容。"
kind: "package-reference"
---

# @deepseek-ai/dsh-self-improve-prompt

[English](README.md) | 中文

## 概述

`dsh-self-improve-prompt` 贡献一个系统提示词区块 `self-improvement`，紧随它所解释的习得教训摘要之后。三个相互独立的开关挂载三段指引：何时值得记录一条教训、如何确认或反驳已在提示词中的教训，以及何时应搜索摘要之外的内容。它不注册任何工具——只写提示词文本，因此每个块都应只在对应工具已挂载的场合挂载。这些文本刻意讲判断而非机制：工具 schema 已经说明了参数是什么，在此重复只会把前缀 token 花在模型本就能读到的内容上。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与习得记忆工具一同挂载它，组合实际提供哪个工具就打开哪个开关。

### 何时选择

凡是挂载了捕获工具的场合都应选择它：拥有工具却不知道什么值得记录的智能体，要么从不反思，要么用复述任务摘要填满存储。对应工具缺席的块应当关闭，因为提及不可调用工具的指引既浪费前缀 token，又会诱发失败调用。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-self-improve-prompt'
  config:
    showReflectionGuidance: true
    showRestatementGuidance: true
    showRecallGuidance: true
```

全部开关关闭时贡献空字符串，装配随即整体省略该区块。

<a id="model-experience"></a>
## 模型体验

### 自我改进提示词区块

#### 模型看到什么

最多三个 markdown 块，按此顺序以空行连接；每个块仅在其开关打开时出现。

##### 记录教训

```markdown
# Recording lessons

Record a lesson when this session produced knowledge a later session would otherwise have to rediscover: an assumption that turned out wrong, a convention specific to this project, a tool or command that behaved unexpectedly, or a approach that worked after simpler ones failed. Do not record the task you performed, a summary of what you changed, or anything already written in the repository — those are in the log and the code. Every lesson must cite the session events that justify it; a lesson you cannot cite is one you should not record.
```

##### 复述教训

```markdown
# Restating lessons

The lessons in your prompt are evidence from earlier sessions, not standing orders. When one proves right again, confirm it — confirmation is the only thing that keeps a lesson from fading. When one misleads you, contradict it promptly and cite what actually happened, rather than silently working around it: an uncontradicted wrong lesson keeps costing later sessions.
```

##### 搜索过往教训

```markdown
# Searching past lessons

Your prompt carries only the highest-standing lessons for this workspace. Search the full record when you need lessons on a specific topic, the evidence behind one before you act on it, or lessons that have faded but may still apply to unusual work.
```

#### Token 影响

每个已挂载的块在每个请求上都是固定开销，与存储持有多少条教训无关。

#### KV 缓存影响

前缀稳定：文本只取决于配置，因此仅在配置变更或插件生命周期事件时改变，绝不逐请求变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该区块何时并不适用。它们是当前的包约束，而非任务待办。

- **文本是固定的。** 部署方无法在不 fork 本包的情况下改写指引；开关选择的是整块内容，而非措辞。
- **开关不会与已挂载工具做校验。** 启用一个对应工具缺席的块会被接受，并产生模型无法据以行动的指引。
- **指引不是强制。** 没有任何机制阻止模型记录反思块要求它跳过的任务摘要。

<a id="dev-note"></a>
### 开发备注

本区块此前宣称了十一个工具名，其中九个只返回 `{ status: 'ok' }` 而不做任何事。请保留取而代之的规则：只有当某个块背后的行为真正就位时才发布它，因为被告知拥有某项自己并不具备的能力的智能体，会把回合花在发现真相上。
