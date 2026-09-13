# Agent Note: The citation route had to exist before instructions could work

Status: implemented

English | [中文](2026-09-13-the-citation-route-had-to-exist.zh.md)

## Problem

`tool-self-reflect` refuses a citation that does not resolve or names no event a turn produced. A model must therefore obtain real sequence numbers from its own session, and three changes in a row told it how: the evidence parameter named `session_event_search`, then the refusal named it too, then both spelled out the arguments.

None of it changed anything, because the tool was not there. `dsh-session-query-sqlite` mounts the query engine in `dsh-base`, but `dsh-tool-session-query` — the model-facing consumer — appeared in no bundle and no profile, and nothing depended on it. A model said so plainly in a transcript: *"The session_event_search tool isn't available."*

With no sanctioned route, models cited whatever numbers were visible. One capture cited `[2,3,4,5]` and `[15,16,17,18]` while its own tool calls sat between seq 165 and 2171: those were the **line numbers** of the file it had just read, which the read tool renders as `1:`, `2:`, `3:` beside each line. Another spawned `pwsh` to `ReadAllBytes` its own `session.jsonl.zstd` and load `[System.IO.Compression.Zstandard.Net.ZstdStream]` reflectively, so it could decompress the log by hand. Bitdefender Advanced Threat Defense scored that command line 49 under `ctc_raw_process_create`. The verdict was a false positive and nothing was quarantined, but a node process spawning a shell that reads a binary wholesale and loads a decompression type at runtime is not distinguishable from fileless execution by shape alone.

Mounting the tool exposed a second layer. Both bundles configure the engine with `openAt: never`, which keeps exact reads, filters and traces working while `searchSessions` and `searchEvents` fail closed and SQLite is never opened. Every call then answered `Error: session search is disabled in this deployment`.

## Decision

### The route is mounted and opened in the Web profile

`dsh-web-app` mounts `dsh-tool-session-query` and opens the index with `openAt: startup`, keeping `path: ':memory:'` so the cost is the SQLite module and a per-process index rather than a file on disk. `dsh-base` is unchanged: the recorded `headless`, `sdk` and `acp` fixtures are untouched, no snapshot drives the Web profile, and nothing pins its tool list.

Indexing lags one turn. A search sees everything before the current turn, which is what a citation needs, and a capture that reads files and then records finds its own earlier calls.

### An instruction names a call, not a tool

The evidence schema and both sequence-related refusals give the whole call: a `query` drawn from the work itself, `event_types` of `tool/call` and `tool/result`, `session_id` omitted for the current session. `session_event_search` requires a non-empty `query`, which the first two rounds of guidance never mentioned, so a model following them composed an invalid call and fell back to the log files. Naming a tool without naming a valid call is worse than naming nothing: it reads as guidance while leaving the same gap.

### An invitation carries the handle it requires

The digest renders each lesson with its identifier, and the preamble says what the identifier is for. `confirm` and `contradict` require `lesson_id`; the digest previously rendered `- **Title** [tags] — body` and the identifier existed only behind a separate recall call. A model that read a lesson in its prompt and decided to restate it passed the **title** in the `lesson_id` field eleven times in one turn, each resolving to nothing.

The same rule produced the same failure twice: a prompt that shows something and asks for an action must supply the handle the action takes, or the model improvises the most plausible visible substitute — line numbers for sequence numbers, a title for an identifier.

### Recording refuses an exact duplicate

A capture whose body is already stored in the same scope is refused, naming the lesson to confirm instead. Recording is cheap and has no identity of its own, so a model restating what it already knows adds a copy rather than raising the original's standing; one store accumulated the same body twice within a minute. The comparison is exact, because a reworded lesson is a different claim and grading the difference is not a check's judgement.

## Alternatives considered

- **Keep improving the wording.** Rejected on evidence: three rounds moved the instruction closer to the point of failure — parameter description, then refusal, then full arguments — and the model still ended at raw file access every time, because the described thing did not exist.
- **Mount the tool in `dsh-base`.** Rejected because base is the composition the recorded fixtures replay; adding a model-visible tool there changes every stored request header. The Web profile is where the reflection tools are enabled and where no fixture looks.
- **Open the index on a file path.** Deferred. `:memory:` costs nothing on disk and covers the current process, which is all a citation lookup needs; a durable index is a separate decision about cross-session search.
- **Add an antivirus exclusion for the harness.** Rejected. The heuristic was reading the situation correctly; the fix is removing the reason the model improvised, not blunting a detector on the process that runs model-authored commands.
- **Render the digest without identifiers and tell models to recall first.** Rejected because it charges a tool round trip to learn the name of something already in the prompt, and the preamble had already invited the action it could not support.

## Consequences

- A capture finds its own sequence numbers with one search and cites `(call, result)` pairs; the first unassisted capture after the route worked cited ten events, all of them work, with no guidance about citations in the prompt.
- No capture since has read a session log by hand, which is the behaviour the antivirus heuristic scored.
- `confirm` and `contradict` both complete from the digest alone.
- Search is opened only where the reflection tools are mounted; a deployment that wants the tools elsewhere must open the index there too, and a profile inheriting `dsh-base` alone still has search disabled.

## Testing

`pnpm run hygiene` 15/15 and `pnpm run doc-sync` 32/32 across the changes; 27 tool tests and 143 memory tests pass at 100% per-file coverage. Verified live rather than only in tests: a search returned `No prior event matches found` on the first turn of a session and four correctly typed hits on the second; an unassisted capture cited ten work events; a `confirm` completed without a recall call; and `audit-memory-citations` reports every stored lesson resolving and naming work.

## Related

- [Citations resolve before they are stored](../bug-fix/2026-09-08-citations-resolve-before-they-are-stored.md) owns the rules these changes made followable.
- [Evidence-bound learned memory](../feature/2026-08-31-evidence-bound-learned-memory.md) owns the seam.
