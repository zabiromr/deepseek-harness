# 习得记忆

[English](memory.md) | 中文

[`@deepseek-ai/dsh-memory`](../../packages/memory/memory) 拥有习得记忆能力缝：智能体在一次会话中记录、并在后续会话中继承的持久教训。有两条规则使得不断累积的存储可信而非仅仅庞大，且二者都归属于该能力缝而非某个具体提供方：每条教训都引用产生它的会话事件，且每条教训的地位都会衰减，除非后续证据予以确认。

来源：[`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

## 目录

- [公开类型](#public-types)
- [证据规则](#the-evidence-rule)
- [地位与衰减](#standing-and-decay)
- [模型看到什么](#what-reaches-the-model)
- [提供方](#providers)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [Cordis API](#cordis-api)

<a id="public-types"></a>
## 公开类型

```ts type-equiv
/** Opaque identity of one stored lesson. */
type LessonId = Branded<'LessonId'>
```

```ts type-equiv
/**
 * Scope a lesson applies to: an absolute workspace directory, or
 * {@link GLOBAL_SCOPE} for lessons that hold everywhere. A digest for a
 * workspace draws from that workspace and the global scope, never from a
 * sibling workspace.
 */
type LessonScope = string
```

```ts type-equiv
/**
 * Lifecycle of a stored lesson. Only `active` lessons reach the digest;
 * `dormant` and `retired` remain recallable so a decayed lesson stays
 * auditable rather than vanishing.
 */
type LessonStatus = 'active' | 'dormant' | 'retired'
```

```ts type-equiv
/**
 * One citation backing a lesson: the session that produced the evidence and
 * the sequence numbers of the events within it. A lesson without at least one
 * citation is rejected — an uncitable lesson cannot be audited, so it cannot
 * be trusted enough to re-enter a prompt.
 */
interface LessonEvidence {
  /** Session the cited events belong to. */
  readonly session: SessionId
  /** Sequence numbers of the cited events, ascending and non-empty. */
  readonly seq: readonly number[]
}
```

```ts type-equiv
/** One durable lesson: what to do differently, and the evidence for it. */
interface Lesson {
  /** Stable identity. */
  readonly id: LessonId
  /** Workspace this lesson applies to, or {@link GLOBAL_SCOPE}. */
  readonly scope: LessonScope
  /** One line stating what to do differently. */
  readonly title: string
  /** The lesson itself, including the circumstances it applies to. */
  readonly body: string
  /** Citations backing the lesson; never empty. */
  readonly evidence: readonly LessonEvidence[]
  /** Free-form retrieval tags. */
  readonly tags: readonly string[]
  /** Epoch milliseconds of first capture. */
  readonly createdAt: number
  /** Epoch milliseconds of the most recent confirmation, or of capture when never confirmed. */
  readonly lastConfirmedAt: number
  /** How many times later evidence confirmed this lesson. */
  readonly confirmations: number
  /** How many times later evidence contradicted it. */
  readonly contradictions: number
  /** Current lifecycle status. */
  readonly status: LessonStatus
}
```

```ts type-equiv
/** Request payload capturing a new lesson. */
interface RecordLessonRequest {
  /** Workspace the lesson applies to, or {@link GLOBAL_SCOPE}. */
  readonly scope: LessonScope
  /** One line stating what to do differently. */
  readonly title: string
  /** The lesson itself. */
  readonly body: string
  /** Citations backing it; a request with none is rejected. */
  readonly evidence: readonly LessonEvidence[]
  /** Free-form retrieval tags. */
  readonly tags?: readonly string[]
}
```

```ts type-equiv
/** Query payload for {@link MemoryService.recall}. */
interface RecallQuery {
  /** Case-insensitive substring matched against title, body, and tags. Absent matches every lesson. */
  readonly text?: string
  /** Restrict to lessons carrying every listed tag. */
  readonly tags?: readonly string[]
  /** Restrict to this workspace plus {@link GLOBAL_SCOPE}. Absent searches every scope. */
  readonly scope?: LessonScope
  /** Statuses to include. Absent includes every status, so a decayed lesson stays findable. */
  readonly statuses?: readonly LessonStatus[]
  /** Maximum lessons returned, highest score first. */
  readonly limit: number
}
```

```ts type-equiv
/** Selection payload for the always-on prompt digest. */
interface DigestQuery {
  /** Workspace whose lessons are drawn, alongside {@link GLOBAL_SCOPE}. */
  readonly scope: LessonScope
  /** Maximum lessons returned, highest score first. */
  readonly maxLessons: number
}
```

```ts type-equiv
/** Outcome of one {@link MemoryService.reclassify} pass. */
interface ReclassifySummary {
  /** Lessons that moved from `active` to `dormant`. */
  readonly demoted: number
  /** Lessons that moved to `retired`. */
  readonly retired: number
  /** Lessons whose status was left unchanged. */
  readonly unchanged: number
}
```

```ts type-equiv
/** Decay parameters shared by scoring and reclassification. */
interface DecayParams {
  /** Milliseconds over which an unconfirmed lesson's score halves. */
  readonly halfLifeMs: number
  /** Score at or below which an `active` lesson becomes `dormant`. */
  readonly dormantFloor: number
  /** Score at or below which a lesson becomes `retired`. */
  readonly retireFloor: number
}
```

<a id="the-evidence-rule"></a>
## 证据规则

`record`、`confirm` 与 `contradict` 都会拒绝没有任何引用的调用。每条引用指明一个会话及其中事件的递增序号，因此任何读者都可以把一条教训回放到产生它的会话日志上。正是这一点使得累积的教训可以重新进入提示词：无人能够核验的主张不是证据，而本框架从不注入这样的内容。

该规则被有意执行了两次。服务边界在任何写入之前就拒绝无引用的请求；持久化 schema 则在记录从介质读回时拒绝无引用的记录，因为手工编辑或写入不完整的存储可能持有从未经过任何服务调用校验的记录。持久化提供方的不变量伴生插件还会监视写入事件流，因此违规会被归因到拥有它的包，而不是稍后以畸形摘要的形式浮现。

<a id="standing-and-decay"></a>
## 地位与衰减

一条教训的分数是 `confirmations - 2 * contradictions + 1`，且每经过 `halfLifeMs` 自上次确认起就减半。

因此一条刚捕获的教训在无人背书的情况下从 1 起步，每次独立确认加 1，每次反驳减 2。这种不对称是有意为之：一条确实误导过智能体的教训，其代价高于一条未经确认的教训，所以两次温和的确认无法挽救一条曾经出错的教训，而一次反驳就会让新教训变为负分——立即离开摘要，无需等待清扫。

衰减是唯一的自动变化。地位上升只能通过 `confirm`，它要求新的引用并重置衰减时钟；反驳则刻意不重置时钟，否则反驳一条陈旧教训反而会让它变新。任何机制都不会仅因会话顺利完成就推断出确认——那种信号恰恰会奖励那些含糊到永远不会被反驳的教训。

状态由分数对照两条下限得出：达到或低于 `dormantFloor` 时教训不再出现在摘要中，达到或低于 `retireFloor` 时则退役。两种状态都不会删除任何内容。退役的教训仍可检索，因此曾经相信过什么、以及支持它的证据，都保持可审计。

<a id="what-reaches-the-model"></a>
## 模型看到什么

两条路径，各司其职：

- [`@deepseek-ai/dsh-memory-prompt`](../../packages/memory/memory-prompt) 贡献一个常驻的系统提示词区块，在字符预算内承载当前工作区中地位最高的 `active` 教训。它按分数排序，而非按与当前任务的相关性：装配时任务尚不可知，因此在那里引入相关性信号只能是猜测。提示词区块同步渲染而选择是异步的，因此该区块提供缓存快照并在每次装配后刷新——最多滞后一次装配，这对于目的在于承载*更早*会话教训的文本而言是正确的。
- [`@deepseek-ai/dsh-tool-knowledge-base`](../../packages/feedback/tool-knowledge-base) 回答摘要无法回答的查询：按主题检索、查看某条教训背后的证据，以及那些已淡出摘要但可能仍然适用的教训。

[`@deepseek-ai/dsh-tool-self-reflect`](../../packages/feedback/tool-self-reflect) 是写入侧，而 [`@deepseek-ai/dsh-self-improve-prompt`](../../packages/feedback/self-improve-prompt) 是告诉模型何时值得花一轮去捕获与复述的指引。

<a id="providers"></a>
## 提供方

| 提供方 | 介质 | 适用场景 |
|---|---|---|
| [`memory-domain`](../../packages/memory/memory-domain) | 一个 `storage-domain` 域，`per-record` 布局 | 教训必须比进程更长寿的部署。单条陈旧或畸形的教训会被单独丢弃，而不会导致整个存储打开失败。 |
| [`memory-ephemeral`](../../packages/memory/memory-ephemeral) | 进程内 `Map` | schema 生成、测试，以及教训不应比进程更长寿的沙箱化或短生命周期部署。 |

选择、评分与复述都是该能力缝拥有的纯函数，因此两个提供方不可能在一条教训价值几何、或摘要展示哪些教训上产生分歧。[`@deepseek-ai/dsh-memory-decay`](../../packages/memory/memory-decay) 只拥有重新分类*何时*运行；参数存放在服务上，因此摘要绝不可能按照清扫并未采用的半衰期来排序。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

这些限制界定了该能力何时并不适用。它们是当前约束，而非任务待办。

- **检索是子串与标签匹配，而非语义搜索。** 措辞与查询不同的教训不会被找到。未来基于向量的提供方是该能力缝的第二个实现，而非对它的改动。
- **摘要按地位排序，而非按当下任务排序。** 一条被多次确认但与当前工作无关的教训，仍会先于一条确认较少但相关的教训占用预算。
- **引用在捕获时不做核验。** 服务检查引用格式良好且递增，但不检查所指事件是否存在；伪造的引用在读取时可被发现，但在写入时不会被拒绝。
- **作用域是目录字符串。** 在工作区子目录中记录的教训不会到达从其根目录启动的会话，而移动工作区会使其教训失联。
- **任何内容都不会被删除。** 退役教训会不断累积；大量记录的部署会让存储无界增长。

<a id="cordis-api"></a>
## Cordis API

由 `scripts/gen-cordis-catalog.ts` 从源码生成（在 doc-sync 中由 `pnpm run verify-cordis-catalog` 校验新鲜度；用 `pnpm run gen-cordis-catalog` 重新生成）——两个语言侧仅在与语言相关的配对文档路径上有差异。签名块使用 `ts cordis-catalog` 围栏并保留源码原始 JSDoc；分发模式定义见[入门](../cordis-primer.zh.md#dispatch-modes)，框架继承的 `ctx` API 见 [cordis-api/inherited.md](../cordis-api/inherited.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryservice-abstract-seam"></a>

### `ctx.memory` — `MemoryService` (abstract seam)

Abstract learned-memory service. Subclass, implement every member, and load the subclass as a plugin — it registers as `ctx.memory` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- record REJECTS a request citing no evidence, before any write.
- confirm and contradict require NEW evidence and are the only ways a lesson's standing rises; nothing infers confirmation from a session merely completing.
- recall searches every status by default, so a decayed lesson stays auditable; digest returns only `active` lessons.
- EVERY method reports failure by REJECTING, never by throwing before it returns; a provider with a synchronous body wraps it in `promised`.
- reclassify is pure arithmetic over stored records — it makes no model calls and never deletes a lesson.

```ts cordis-catalog
/**
 * Capture one lesson with its citations.
 * @param request - Scope, title, body, evidence, and tags.
 * @returns the stored lesson; rejects with `missing-evidence` when uncited.
 */
abstract record(request: RecordLessonRequest): Promise<Lesson>

/**
 * Raise a lesson's standing with new evidence and reset its decay clock.
 * @param id - The lesson to confirm.
 * @param evidence - New citations supporting it; never empty.
 * @returns the updated lesson; rejects `not-found` for an unknown id.
 */
abstract confirm(id: LessonId, evidence: readonly LessonEvidence[]): Promise<Lesson>

/**
 * Lower a lesson's standing with evidence against it.
 * @param id - The lesson to contradict.
 * @param evidence - New citations against it; never empty.
 * @returns the updated lesson; rejects `not-found` for an unknown id.
 */
abstract contradict(id: LessonId, evidence: readonly LessonEvidence[]): Promise<Lesson>

/**
 * Search stored lessons, highest score first.
 * @param query - Text, tag, scope, and status filters plus a result cap.
 * @returns the matching lessons, ranked.
 */
abstract recall(query: RecallQuery): Promise<readonly Lesson[]>

/**
 * Select the `active` lessons that belong in the always-on prompt digest.
 * @param query - Scope and lesson cap.
 * @returns the selected lessons, highest score first.
 */
abstract digest(query: DigestQuery): Promise<readonly Lesson[]>

/**
 * Read one lesson by id.
 * @param id - The lesson to read.
 * @returns the lesson, or `undefined` when absent.
 */
abstract get(id: LessonId): Promise<Lesson | undefined>

/**
 * Apply decay to every stored lesson's status, using {@link decay}.
 * @param now - Epoch milliseconds to evaluate at.
 * @returns counts of what moved.
 */
abstract reclassify(now: number): Promise<ReclassifySummary>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
