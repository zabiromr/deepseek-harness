# Agent Note: 空闲看门狗用例必须长于连接建立

Status: implemented

[English](2026-09-06-idle-watchdog-window-versus-connect-setup.md) | 中文

## Problem

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` 通过给 provider 设置 20 毫秒的 `streamIdleTimeoutMs`、编排每 200 毫秒到达一个事件的回复，并等待一秒以观察 mock 服务器的响应关闭，来证明适配器的流空闲看门狗会停止 SDK 请求。

第一个空闲窗口并不只覆盖事件之间的间隔，它同时覆盖请求的发出：`watchdog.next` 装载定时器，而拉取迭代器才是发送请求的动作。在环回连接建立开销超过该窗口的宿主上——在一台 Windows 开发机上实测约 45 毫秒，而窗口只给了 20 毫秒——看门狗在请求写出之前就触发，SDK 放弃该请求，服务器的处理函数从未运行。用例随后等待一个从未打开过的套接字关闭，并报告 `SDK request did not close after idle timeout`，而这次运行中并不存在它所指认的传输故障。该用例在 Linux 宿主上、以及 Node 24 与 25 上都通过，因此这次失败看起来像是平台相关的产品行为，而不是用例从未给自己留出的预算。

在那次运行中适配器是正确的。在请求离开进程之前就中止是更强的结果；一个独立复现脚本确认，在同一台 Windows 宿主上，`fetch` 中止会在 52 毫秒内关闭服务器响应，因此 Node 与 undici 都没有丢失该中止。

## Decision

### 被测窗口在一条已建立且静默的流上关闭

mock 服务器新增 `hold` 行为：写完编排的事件后保持响应打开而不结束它。用例只编排一个事件并启用 `hold`，因此第二个空闲窗口是因为无人发送而到期——这是脚本的性质，而不是编排延迟与定时器之间的竞争。`closeMockServers` 现在先断开连接再等待 `close`，否则被保持打开的响应会让清理一直等待一个无人完成的连接。

`STREAM_IDLE_MS` 为 1 秒。第一个窗口仍然覆盖连接建立，任何测试都无法消除这一点；测试能做的是给这段建立时间留出实测开销二十倍的预算，而不是它的一半。

### 前置条件被断言，而非假定

mock 服务器暴露 `requestReceived`，用例在断言任何与关闭有关的事实之前先等待它。无法在空闲窗口内发出环回请求的宿主，现在会以 `SDK request never reached the server` 失败。通过把窗口缩回 20 毫秒得到验证：用例报告的正是这句话，而不是套接字消息。

### 三个预算按序排列

被测窗口（1 秒）低于用例对固定装置信号的等待上界（5 秒），后者又低于用例预算（20 秒）。该上界此前为 30 秒，高于 Vitest 的 5 秒默认值，因此运行器自身的超时先结束了用例，诊断信息从未打印——失败退化为一句干巴巴的 `Test timed out`。一个活不过其所在运行器的上界，什么也报告不了。

## Alternatives considered

- **只调高 `streamIdleTimeoutMs`。** 作为完整修复被否决：它给出了余量却没有指明运行在等待什么，一旦预算失守，用例仍会归咎于套接字。这里确实调高了窗口，但同时加上了一个被断言的前置条件，用以说明发生的是两种失败中的哪一种。
- **在 Windows 上跳过该用例。** 被否决，因为该行为并非平台相关，只有预算是。跳过会把一个正确的适配器行为藏在平台排除之后。
- **保留 200 毫秒编排事件并缩短窗口。** 被否决，因为这只是以更窄的形式恢复同一场竞争：超时仍与一次计划中的写入竞争，而不是在一条按构造静默的流上到期。
- **伪造时钟。** 被否决，因为该用例操作的是真实套接字，伪造定时器只能证明看门狗的算术，而非 SDK 请求确实被关闭。

## Consequences

- 该用例由自身的空闲窗口而非宿主的环回时延决定，耗时约一秒。
- `hold` 与 `requestReceived` 可供任何后续需要"已建立但停止发送"的流的用例使用。
- 未来的预算失守会报告自身原因，下一位读者不会被引去寻找并不存在的传输缺陷。

## Testing

`pnpm vitest run packages/llm/llm-pi-ai/tests/adapter.spec.ts`——在此前失败的 Windows 上 50 项通过。Linux 上 `pnpm vitest run packages/llm/llm-pi-ai`——276 项通过。反向对照：将 `STREAM_IDLE_MS` 设为 20 毫秒时，用例以 `SDK request never reached the server` 失败。

## Related

- [CI 测试可靠性技能](2026-08-28-ci-test-reliability-skill.zh.md)拥有本文遵循的规则：在状态上同步、为预算排序，并拒绝未指明其等待对象的超时调高。
- [Windows 通道钩子与 Lefthook 预算](2026-08-29-windows-lane-hook-and-lefthook-budget.zh.md)记录了相邻的一例：预算与其宿主不匹配。
