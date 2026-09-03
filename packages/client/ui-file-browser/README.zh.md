---
description: "浏览器侧文件浏览界面：侧边栏底部操作与详情面板浮层，用于打开并编辑工作区文件，供选择、配置或排查该界面的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-file-browser

[English](README.md) | 中文

## 概述

`dsh-client-ui-file-browser` 新增两个浏览器侧界面：侧边栏底部用于打开详情面板的操作入口，以及详情面板正文——它列出目录、进入子目录、打开文件并就地编辑。列举与读写都经由会话 Remote（`file.list`、`file.read` 与 `file.write`）完成，因此浏览器从不直接接触文件系统。其 node 半边是一个空的 `apply`——本包只负责呈现，浏览器半边通过 `exports["./client"]` 交付。请在已提供布局、渲染器、会话与语言环境界面的 Web 组合中挂载它。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当希望用户能够从侧边栏打开工作区文件、阅读并编辑，而无需离开会话视图时，在 Web profile 中挂载本包。

### 何时选择

当部署的用户面向本地工作区工作、并希望在对话记录旁就地编辑文件时选择它。编辑受版本保护：会替换掉打开之后新写入内容的保存将被拒绝——当 agent 同时在改动同一个工作区时，这一点尤其重要。它要求部署挂载文件系统 provider：缺少它时会话 Remote 会以 `unsupported` 拒绝 `file.list`、`file.read` 与 `file.write`，浏览器随即显示列举失败。仅供自动化的界面不应加入它，因为那些界面根本不挂载浏览器半边。

### 最小配置

本包不接受任何配置。挂载这一行就是全部设置；该行应与 Web bundle 中其他客户端 UI 行并列。

```yaml
- id: ui-file-browser
  name: '@deepseek-ai/dsh-client-ui-file-browser'
```

该插件注入 `slots`、`layout`、`locale`、`remote` 与 `remote.session`，并填充 `ui-chat` 声明的 `conversation.details.browser` 插槽，因此两个包必须一同挂载，浏览器才会出现。只要没有选中工具调用，详情面板就渲染该插槽，因此侧边栏操作只需打开面板。

<a id="model-experience"></a>
## 模型体验

### 无面向模型的界面

#### 模型看到什么

什么都看不到。本包既不调用 `ctx.tools.register` 也不调用 `ctx.systemPrompt.section`，也不追加会话事件。它是一个浏览器呈现界面：用户通过它读取或编辑的内容，只有在用户或其他插件将其放入对话时才会到达模型。

#### Token 影响

无。本包不增加 schema、不增加提示词文本、也不产生工具结果，因此在任何请求上都不消耗模型 token。

#### KV 缓存影响

无。挂载或卸载本包都不会改变请求前缀，因此既不改善也不失效 KV 缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本包在什么情况下并不适用。它们是当前的包约束，而不是任务待办列表。

- **浏览从会话工作区根目录开始，且无法向上越过它。** 拥有方只交给浏览器一个根目录；`返回` 只回退它走过的路径并止于根，因此工作区之外的路径只能通过打开以该处为根的会话访问。
- **符号链接子项会跳转到其目标。** 宿主会解析每个列出的子项，因此打开符号链接即打开解析后的路径——浏览器显示的是目标位置，而非链接位置。
- **冲突只被报告，不会被合并。** 保存会携带该次编辑所基于的版本，因此打开之后已在磁盘上变化的文件会被拒绝写入而不是被覆盖——但解决冲突意味着重新载入并手工重做编辑，没有合并视图。
- **读取上限是整文件限制。** `file.read` 对超过 `fileReadMaxBytes`（默认 2 MiB）的文件直接拒绝，而不是返回前缀，因此超大日志无法通过该界面查看。
- **列举结果是一次快照。** 目录在打开期间于磁盘上变化时不会自动重新列举；离开再进入才会刷新行。

<a id="dev-note"></a>
### 开发备注

node 半边刻意只重新导出类型。它此前的形态重新导出了 React 组件，从而把 `.module.css` 导入拉进 node bundle 并导致构建失败——浏览器组件必须只能通过 `exports["./client"]` 抵达。`DetailsBrowser` 通过 `src/client/index.ts` 中构造的注入面接收其文件系统回调，而不是自己导入 Remote，正是这一点让组件可测试，并让授权身份留在注册方条目上。
