# Agent Note: Workspace file browser in the details panel

Status: implemented

English | [中文](2026-09-02-workspace-file-browser-details-slot.zh.md)

## Problem

`@deepseek-ai/dsh-client-ui-file-browser` shipped a sidebar action and a details-panel surface, but it registered into `details` — the single slot `ui-chat` already occupies — so the whole plugin tree refused to load with `single slot "details" already has a registration at priority 0`. Neither surface worked underneath that failure: the sidebar button toggled local state nobody read, the panel passed a hardcoded empty path, and the listing called `window.dshListDirectory`, a global no package in this repository defines.

## Decision

**The details panel declares `conversation.details.browser`; the file browser only registers into it.** A `children` table in `slots.register()` both declares a child slot and claims the exclusive right to render it, so the declaring entry must be the one that owns the location — the details panel. `ui-chat` declares the key beside `conversation.details.tool` and owns its `DetailsBrowserOwnerProps`; `ui-file-browser` depends on that contract and supplies its own inject face, the same relationship `ui-tool` has with `conversation.details.tool`. The dependency runs registrant → declarer, never back.

**Selection decides which body the panel shows.** With a Tool call selected the panel renders the Tool slot; with none it renders the browser slot, falling back to its existing empty state where no browser is mounted. The sidebar action therefore only calls `layout.openDetails()`, and a header control returns a selected panel to the browser by clearing the selection. No cross-package view state exists, and no control leads to a surface a composition did not mount.

**Directory listing is a Session Remote, not a host global.** `session.file.list` resolves a path, refuses a non-directory, and returns each direct child's name, resolved Host path, and type in the filesystem's stable name order. It joins `file.read` and `file.write`, and all three now read `fs` as an optional service: a deployment mounting no filesystem provider keeps every other Session operation and refuses only these three as `unsupported`.

**A save proves which content it replaces.** `file.read` returns the Host's freshness token with the content, and `file.write` accepts it as `expectedVersion`, which the backend enforces as `replaceIfVersion`. A file changed since it was opened fails `stale-version`, and the browser keeps the user's buffer and offers a reload instead of replacing content nobody saw. Omitting the version still overwrites unconditionally, so the guard is the caller's to opt into and other callers are unaffected. `file.read` also refuses a file over the configured `fileReadMaxBytes` by its stat size before decoding, and converts the backend's binary refusal into `not-text` rather than leaking an internal error.

**`FileEditor` saves through an owner callback.** The primitive took no save handler and returned to view mode after a 300 ms timer, so a Save button could report success while writing nothing. It now takes `onSave`, keeps the buffer in edit mode when the write fails, and hides the edit affordance entirely when no handler is supplied.

## Verification

`session-files.host.spec.ts` pins listing order, absent and non-directory paths, read and write outcomes, the no-filesystem refusal, the read ceiling and binary refusal, and both sides of the guarded write — including that a refused stale write leaves the newer content on disk — against an in-memory `FileSystem`. `details-browser.client.spec.tsx` pins the root listing, descent and return, the open-edit-save round trip, failed listing, read, and write, the Host handoff, and the missing-root state. Driving the real `dsh web` server end to end listed the workspace, walked into `docs/`, opened a file, and wrote an edited buffer that landed on disk.

## Alternatives considered

**Let the parent supply the browser's inject face through the `children` table.** Rejected: the callbacks carry the registrant's own Remote authority, and the declaring panel would have to hold filesystem access it otherwise never needs.

**Keep a two-way toggle inside the panel body.** Rejected: it offered a control that lands on an empty surface wherever the browser package is absent, and it duplicated state that selection already expresses.

**Merge a conflicting edit, or reload it silently.** Rejected: a merge view is a larger surface than this panel earns, and silently reloading discards the user's typing. Refusing the write and holding the buffer keeps the decision with the person who made the edit.

**Compute the parent directory on the Host and return it with each listing.** Rejected: a client-held trail of visited directories needs no cross-platform path arithmetic and keeps browsing inside the workspace the Session opened.

## Consequences

- A composition that mounts `ui-file-browser` without `ui-chat` registers into an undeclared slot and fails loud at load, which is the intended coupling.
- Listing rows key by name: the Host resolves each listed child, so a symlink and its target repeat one path inside a single listing, and keying by path silently dropped and stranded rows.
- Adding another details body is now a declaration in the panel plus a registrant, with no change to `ui-chat`'s render logic beyond choosing when to show it.
