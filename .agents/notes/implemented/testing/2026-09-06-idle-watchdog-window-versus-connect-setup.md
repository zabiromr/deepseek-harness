# Agent Note: The idle-watchdog case must outlast connection setup

Status: implemented

English | [中文](2026-09-06-idle-watchdog-window-versus-connect-setup.zh.md)

## Problem

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` proved that the adapter's stream idle watchdog stops the SDK request by giving the provider a 20 ms `streamIdleTimeoutMs`, scripting a reply whose events arrive every 200 ms, and waiting one second for the mock server to observe its response close.

The first idle window does not cover a gap between events. It covers dispatching the request as well: `watchdog.next` arms the timer, and pulling the iterator is what sends the request. On a host where loopback connection setup costs more than the window — roughly 45 ms measured on a Windows development host, against 20 ms granted — the watchdog fires before the request is written, the SDK abandons it, and the server's handler never runs. The case then waited for the close of a socket that had never opened and reported `SDK request did not close after idle timeout`, which names a transport fault the run does not contain. It passed on Linux hosts and on Node 24 and 25 alike, so the failure read as platform-specific product behavior rather than as a budget the case never granted itself.

The adapter is correct in that run. Aborting before the request leaves the process is the stronger outcome, and a standalone repro confirmed that a `fetch` abort closes the server response within 52 ms on the same Windows host, so neither Node nor undici loses the abort.

## Decision

### The window under test closes on an established, silent stream

The mock server gained a `hold` behavior: after writing its scripted events it keeps the response open instead of ending it. The case scripts one event with `hold`, so the second idle window expires because nothing is sending — a property of the script, not a race between a scripted delay and a timer. `closeMockServers` now drops connections before awaiting `close`, because a held response would otherwise leave teardown waiting for a connection nothing completes.

`STREAM_IDLE_MS` is 1 s. The first window still covers connection setup, and no test can remove that; what it can do is grant the setup a budget twentyfold the measured cost instead of half of it.

### The precondition is asserted, not assumed

The mock server exposes `requestReceived`, and the case awaits it before asserting anything about closing. A host that cannot dispatch a loopback request inside the idle window now fails with `SDK request never reached the server`. Verified by shrinking the window back to 20 ms: the case reports that sentence rather than the socket message.

### The three budgets are ordered

The window under test (1 s) sits below the case's bound on a fixture signal (5 s), which sits below the case budget (20 s). The bound previously stood at 30 s, above Vitest's 5 s default, so the runner's own timeout ended the case first and the diagnostic never printed — the failure degraded to a bare `Test timed out`. A bound that cannot outlive the harness it runs under cannot report anything.

## Alternatives considered

- **Raise `streamIdleTimeoutMs` alone.** Rejected as the whole fix: it grants headroom without naming what the run waits for, and the case would still blame the socket when the budget is lost. The window is raised here, but alongside an asserted precondition that says which of the two failures occurred.
- **Skip the case on Windows.** Rejected because the behavior is not platform-specific; only the budget was. A skip would have hidden a correct adapter behind a platform exclusion.
- **Keep scripted 200 ms events and shorten the window.** Rejected because it restores the same race in a narrower form: the timeout still competes with a scheduled write instead of expiring on a stream that is silent by construction.
- **Fake the clock.** Rejected because the case exercises a real socket, and a faked timer proves the watchdog's arithmetic rather than that the SDK request actually closes.

## Consequences

- The case is bound by its own idle window rather than by the host's loopback latency, and costs about one second.
- `hold` and `requestReceived` are available to any later case that needs an established stream that stops sending.
- A future budget loss reports its own cause, so the next reader is not sent to look for a transport defect.

## Testing

`pnpm vitest run packages/llm/llm-pi-ai/tests/adapter.spec.ts` — 50 passed on Windows, where the case previously failed. `pnpm vitest run packages/llm/llm-pi-ai` on Linux — 276 passed. Negative control: with `STREAM_IDLE_MS` at 20 ms the case fails with `SDK request never reached the server`.

## Related

- [The CI test-reliability skill](2026-08-28-ci-test-reliability-skill.md) owns the rules this follows: synchronize on state, order the budgets, and reject a raised timeout that does not name its awaited work.
- [The Windows lane hook and Lefthook budget](2026-08-29-windows-lane-hook-and-lefthook-budget.md) records the neighbouring case of a budget that did not match its host.
