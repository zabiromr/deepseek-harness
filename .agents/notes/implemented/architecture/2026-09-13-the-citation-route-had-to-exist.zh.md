# Agent Note: 引用路径必须先真实存在，指令才可能奏效

Status: implemented

[English](2026-09-13-the-citation-route-had-to-exist.md) | 中文

## Problem

`tool-self-reflect` 会拒绝无法解析、或未指向本轮工作所产生事件的引用。模型因此必须从自身会话中取得真实的序号，而连续三次改动都在告诉它怎么做：先是证据参数点名 `session_event_search`，接着拒绝消息也点名它，最后两者都写清了参数。

这些都没有产生任何变化，因为那个工具根本不在。`dsh-session-query-sqlite` 在 `dsh-base` 中挂载了查询引擎，但面向模型的消费方 `dsh-tool-session-query` 没有出现在任何 bundle 或 profile 中，也没有任何包依赖它。一个模型在转录里把话说得很直白：*"The session_event_search tool isn't available."*

在没有受认可路径的情况下，模型引用了视野里任何可见的数字。某次捕获引用了 `[2,3,4,5]` 与 `[15,16,17,18]`，而它自己的工具调用位于 seq 165 到 2171 之间：那些是它刚刚读过的文件的**行号**——read 工具会在每行内容前渲染 `1:`、`2:`、`3:`。另一次则派生 `pwsh` 去 `ReadAllBytes` 自己的 `session.jsonl.zstd`，并反射加载 `[System.IO.Compression.Zstandard.Net.ZstdStream]`，以便手工解压日志。Bitdefender Advanced Threat Defense 以 `ctc_raw_process_create` 为该命令行打了 49 分。该判定是误报，也没有任何内容被隔离，但一个 node 进程派生 shell、整体读取二进制文件、并在运行时加载解压类型，仅从形态上与无文件执行无法区分。

挂载该工具后又暴露出第二层。两个 bundle 都以 `openAt: never` 配置引擎：精确读取、过滤与追踪照常可用，而 `searchSessions` 与 `searchEvents` 则以失败关闭，SQLite 从不打开。于是每次调用都回答 `Error: session search is disabled in this deployment`。

## Decision

### 该路径在 Web profile 中被挂载并打开

`dsh-web-app` 挂载 `dsh-tool-session-query`，并以 `openAt: startup` 打开索引，同时保留 `path: ':memory:'`，因此代价是 SQLite 模块与一份进程内索引，而不是磁盘上的文件。`dsh-base` 保持不变：录制的 `headless`、`sdk` 与 `acp` 固定装置不受影响，没有任何快照驱动 Web profile，也没有任何测试固定它的工具清单。

索引滞后一个轮次。搜索能看到当前轮次之前的一切，而这正是引用所需要的：先读文件、随后记录的捕获能够找到自己更早的调用。

### 指令给出的是一次调用，而不是一个工具名

证据 schema 与两条与序号相关的拒绝消息都给出完整调用：取自工作本身的 `query`、`tool/call` 与 `tool/result` 的 `event_types`、以及针对当前会话省略 `session_id`。`session_event_search` 要求 `query` 非空，而前两轮指引从未提及这一点，因此照做的模型组装出非法调用，转而退回日志文件。只点名工具而不给出合法调用，比什么都不说更糟：它看起来像指引，却留下了同一个缺口。

### 邀请必须附带它所需的把手

摘要现在为每条教训渲染其标识符，前言也说明该标识符的用途。`confirm` 与 `contradict` 需要 `lesson_id`；而摘要此前渲染的是 `- **Title** [tags] — body`，标识符只存在于另一次召回调用之后。一个在提示词中读到教训并决定重述它的模型，在一个轮次里十一次把**标题**填进了 `lesson_id` 字段，每一次都解析为空。

同一条规律造成了同样的失败两次：提示词展示某物并要求采取行动时，必须提供该行动所需的把手，否则模型就会即兴取用视野内最像样的替代品——用行号代替序号，用标题代替标识符。

### 记录会拒绝完全重复的内容

若某次捕获的正文在同一作用域中已存在，该调用会被拒绝，并指明应当去 confirm 的那条教训。记录成本低廉且自身没有身份，因此模型重述已知内容时只会新增副本，而不是抬升原有教训的地位；某个存储曾在一分钟内累积了同一段正文两次。比较是精确匹配，因为改写过的教训属于不同主张，而为差异程度打分并非一项检查该做的裁量。

## Alternatives considered

- **继续打磨措辞。** 依据证据被否决：三轮改动把指令一步步挪近失败发生的位置——参数描述、然后是拒绝消息、然后是完整参数——而模型每一次仍然止步于原始文件访问，因为被描述的东西并不存在。
- **在 `dsh-base` 中挂载该工具。** 被否决，因为 base 正是录制固定装置所回放的组合；在那里新增一个模型可见的工具会改变每一份已存请求头。Web profile 才是反思工具启用之处，也是没有固定装置窥视的地方。
- **将索引开在文件路径上。** 推迟。`:memory:` 不占磁盘且覆盖当前进程，这正是引用查找所需的全部；持久索引是关于跨会话搜索的另一个决定。
- **为 harness 添加杀毒排除项。** 被否决。该启发式对情境的判断是正确的；正确的做法是移除模型即兴发挥的理由，而不是钝化一个监视着运行模型自撰命令的进程的检测器。
- **摘要不渲染标识符，转而要求模型先召回。** 被否决，因为这要为"得知提示词里已有之物的名字"付出一次工具往返，而前言早已发出它无法支撑的行动邀请。

## Consequences

- 一次捕获只需一次搜索即可找到自己的序号，并以 `(call, result)` 成对引用；路径打通后第一次无辅助捕获引用了十个事件，全部是工作事件，而提示词中没有任何关于引用的指引。
- 此后没有任何捕获再手工读取会话日志，而那正是杀毒启发式所打分的行为。
- `confirm` 与 `contradict` 都能仅凭摘要完成。
- 搜索仅在挂载了反思工具之处被打开；希望在别处使用这些工具的部署也必须在那里打开索引，而仅继承 `dsh-base` 的 profile 其搜索仍处于禁用状态。

## Testing

各项改动上 `pnpm run hygiene` 15/15、`pnpm run doc-sync` 32/32；27 项工具测试与 143 项 memory 测试通过，改动源文件按文件 100% 覆盖。并非只在测试中验证，而是实机验证：某会话第一轮搜索返回 `No prior event matches found`，第二轮返回四条类型正确的命中；一次无辅助捕获引用了十个工作事件；一次 `confirm` 无需召回调用即告完成；`audit-memory-citations` 报告每条已存教训都可解析且指向工作。

## Related

- [引用在存储之前先完成解析](../bug-fix/2026-09-08-citations-resolve-before-they-are-stored.zh.md)拥有这些改动所使之可被遵循的规则。
- [带证据的习得记忆](../feature/2026-08-31-evidence-bound-learned-memory.zh.md)拥有该能力缝。
