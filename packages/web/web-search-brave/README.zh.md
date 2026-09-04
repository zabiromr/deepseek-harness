---
description: "ctx.web 的 Brave Search 搜索提供者：如何将部署挂载到 Brave Search 以获取结构化来源和元数据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-brave

[English](README.md) | 中文

## 概述

使用 `dsh-web-search-brave`，Harness 通过 [Brave Search](https://brave.com/search/api/) 搜索网络，并获得带有标题、URL、摘要和日期的结构化来源。当部署拥有 Brave Search API 密钥且需要元数据丰富的结果时，选择此后端。模型面临的 `web_search` 工具位于 `dsh-tool-web` 中。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已加载 web 服务的组合中挂载提供程序；它注册为 `brave` 搜索提供程序，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析它——或者使用 `searchProvider: brave` 进行固定。

### 何时选择它

当部署拥有 Brave Search API 密钥且需要结构化、元数据丰富的结果时选择此后端。当 API 密钥为空或端点不合法时，提供程序不可用。

### 最小配置

加载 web 服务和提供程序；API 密钥从启动环境回退到 `$BRAVE_API_KEY`，所有其他设置都有安全默认值。

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-web-search-brave'
  config:
    apiKey: !!js process.env.BRAVE_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | `$BRAVE_API_KEY` | Brave Search API 密钥；为空或缺失时提供程序不可用 |
| `endpoint` | `https://api.search.brave.com/res/v1/web/search` | API 端点。无法解析的值使提供程序不可用 |
| `numResults` | (未设置) | 搜索请求的默认结果数 |

生成的 [配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-brave) 是每个接受字段及其 JSDoc 的权威来源。

### 搜索返回什么

`sources[]` 携带带有 `url`、`title`、`snippet` 和 `publishedAt` 的结构化结果。Brave Search 没有生成的答案字段，所以 `content` 被省略。服务通过截断和标记来强制实施 `maxResults`。

### 故障恢复

提供程序故障（HTTP 错误、网络故障、无法解析或形状错误的主体）显示为 `WebError` `WEB_PROVIDER_ERROR`；中止的请求显示为 `WEB_ABORTED`。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部结构 — 点击展开</summary>

本节介绍提供程序的设计决策；可观察的行为完全在[使用本包](#use-this-package)中覆盖。

### 设计哲学

提供程序是对 Brave Search API 的简单适配，有一条规则：

- **结构化结果是合同。** 每个 Brave Search 结果都携带 `title`、`url` 和 `description`；`publishedDate` 是可选的。提供程序将这些直接映射到标准化的 `WebSearchSource` 形状。

### 文件结构

| 文件 | 角色 |
|---|---|
| `[src/index.ts](src/index.ts)` | 插件入口：配置模式、环境回退、提供程序注册 |
| `[src/provider.ts](src/provider.ts)` | `BraveSearchProvider`：请求分发、中止分类、结果映射 |
| `[src/types.ts](src/types.ts)` | Brave Search API 响应的线类型 |
| `[src/invariant.ts](src/invariant.ts)` | 不变量伴生（没有运行时不变量；合同在服务中强制执行） |

### 请求与映射流程

`search()` 向 Brave 端点发送一个 GET 请求，携带 `q`（查询）、`count`（结果数上限）以及 `X-Subscription-Token` 请求头。每个 `web.results[]` 条目映射为一个带有 `url`、`title`、`snippet` 与 `publishedAt` 的 `WebSearchSource`。服务在返回路径上施加最终的 `maxResults` 约束。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 子系统](../../../docs/subsystems/web.zh.md) — 详尽的搜索请求/结果词汇表与错误码。
- [Web 包映射](../README.zh.md) — 六包家族与各自的角色。
- [dsh-web](../web/README.zh.md) — 本提供程序注册进入的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md) — 面向模型、渲染本提供程序来源的 `web_search` 工具。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-brave) — 每个被接受的配置字段及其来源声明。
- [Web capability seam 决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) — 为什么搜索与抓取共享一个 provider 选择服务。

-----

<a id="model-experience"></a>
## 模型体验

### 辅助 Brave 请求

#### 模型所见

单独的 Brave Search API 调用接收 `<query>` 作为其 `q` 参数。此请求不属于对话模型的上下文。

#### Token 影响

注册零直接对话 token。Source tokens 是数据相关的，source 计数是服务限制的。

#### KV Cache 影响

追加；新可见内容遵循可重用请求前缀，不使现有 KV-cache 条目失效。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义了提供程序不适合的场景。它们是当前的包约束。

- **没有生成的答案** — Brave Search 只返回结构化来源；`content` 始终被省略，因此没有提供商生成的摘要或答案文本。
- **发布日期稀疏** — `publishedAt` 是可选的，并非所有结果都包含它；没有它的来源简单地省略该字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

#### 未来：Brave 内容缓存端点

Brave Search 提供了一个 `/search/web` 缓存内容端点。添加它作为 `WebFetchProvider` 需要一个新的 `web-search-brave-fetch` 包或扩展此包。

</details>

