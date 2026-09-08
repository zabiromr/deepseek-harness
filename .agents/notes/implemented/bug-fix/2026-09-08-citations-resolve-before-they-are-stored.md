# Agent Note: Citations resolve before they are stored

Status: implemented

English | [中文](2026-09-08-citations-resolve-before-they-are-stored.zh.md)

## Problem

The learned-memory seam requires every lesson to cite the session events that produced it, because a lesson that cannot be replayed against a log is not auditable and must never re-enter a prompt. `assertEvidence` enforced that citations exist, list ordinal sequence numbers, and ascend. Nothing checked that any of it referred to anything.

`resolveEvidence` in `dsh-tool-self-reflect` read the citation as the model wrote it:

```ts ignore-check
const session = citation.session ?? fallback
…
return { session: session as SessionId, seq: [...citation.seq] }
```

The `??` supplies the calling session only when the field is absent. A model that writes any string keeps it, and the cast makes it a `SessionId` without asking whether one exists. Sequence numbers were never compared against a log at all.

The first lesson a model recorded in this workspace took both paths at once. It cited `session: "current"` — a placeholder, not an identifier — and `seq: [6, 7]`, which in the session that actually recorded it are `agent/inbox/spliced` and `step/start`: session setup, appended before the work the lesson describes. The real evidence sat between seq 65 and seq 1170. The lesson was stored, entered the digest, and reached a later session's prompt carrying evidence that pointed at nothing.

This is the failure the [package rules](../../../../packages/AGENTS.md) name directly: model and tool JSON is a validation boundary, and a `SessionId` produced by casting a model-written string has crossed it unchecked.

## Decision

### The writing Consumer resolves; the service keeps form

`assertEvidence` stays as it is. It runs inside every provider, is medium-independent, and has no session to read, so ordering and ordinality are the whole of what it can decide. Resolvability needs the session log, and the only role holding one is the Consumer that receives the model's call.

`resolveEvidence` now resolves rather than records. A citation naming no session resolves to the calling session, as before. A citation naming one resolves to the calling session when the id matches, otherwise through the session store; an id that resolves to neither is refused with `invalid-evidence` and the name it supplied. Every sequence number must then name an event the resolved session holds, checked with `Session.eventAt`. What is stored is the resolved session's own id, never the model's string.

### The store is read optionally, at call time

The tool reads `sessions` through `ctx.get`, not through `inject`. A composition can mount the capture tool without the session store, and such a deployment still records lessons citing the calling session; only a citation naming a different session needs the store, and without it that citation is refused rather than silently trusted. Reading at call time rather than at `apply` lets a store mounted after this plugin still serve lookups.

### The schema states the obligation

The `session` parameter tells the model to omit it for the current session and to pass only an id a session reported; the `seq` parameter states that a number no event carries is refused. A model that reads the schema has what it needs to write a citation that resolves.

## Alternatives considered

- **Validate inside the memory service.** Rejected because it would put a session dependency into a Service Definition whose providers are medium adapters, inverting the seam so one Consumer's context dictates the service contract.
- **Accept an unresolvable session and mark the lesson unverified.** Rejected because standing already governs whether a lesson reaches a prompt, and a second axis of trust would let unreplayable evidence accumulate rather than be refused at the one moment the writer can still fix it.
- **Resolve sessions from disk as well as from the store.** Deferred, not rejected. It would let a lesson cite a session this process never loaded, which is a real case; it needs a reader the seam does not currently own, and the README records the limitation.
- **Leave `seq` unchecked and validate only the session.** Rejected because the recorded example got the session *and* the sequence numbers wrong, and a citation into a real session at meaningless offsets is exactly as unreplayable.

## Consequences

- A stored citation names a session that existed and events that exist, so replaying one is a lookup rather than a search.
- A citation into a session held only on disk is refused. The README states this, and lifting it means adding a persisted-session reader.
- Lessons recorded before this change keep whatever they were given; nothing rewrites them, and one in this workspace still cites `current`.
- Three cases in `tool-self-reflect.spec.ts` changed with the behavior: an explicit foreign session used to be stored verbatim and is now refused unless the store can read it.

## Testing

`pnpm run test -- packages/feedback/tool-self-reflect` — 18 passed, covering a refused unreadable session, a refused sequence number naming no event, and an accepted citation into a second session the store can read. The seeded session carries three completed turns so its citations resolve; a session with an empty log can cite nothing.

## Related

- [Evidence-bound learned memory](../feature/2026-08-31-evidence-bound-learned-memory.md) owns the evidence rule this enforces.
