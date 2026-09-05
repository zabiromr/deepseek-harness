---
description: "Browser-side file browser surface: a sidebar footer action and a details-panel overlay for opening and editing workspace files, for maintainers choosing, configuring, or debugging the surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-file-browser

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-file-browser` adds two browser-side surfaces: a footer action in the sidebar that opens the details panel, and the panel body that lists a directory, walks into subdirectories, opens a file, and edits it in place. Listings, reads, and writes go through the session Remote (`file.list`, `file.read`, and `file.write`), so the browser never touches the filesystem directly. The node half is an empty `apply` — this package is presentation only, and its browser half ships through `exports["./client"]`. Mount it in a Web composition that already provides the layout, renderer, session, and locale surfaces.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package in a Web profile when a user should be able to open a workspace file from the sidebar, read it, and edit it without leaving the session view.

### When to choose it

Choose it for a deployment whose users work against a local workspace and want in-place file editing beside the transcript. Edits are version-guarded: a save that would replace content written since the file was opened is refused, which matters when an agent edits the same workspace. It requires a mounted filesystem provider: the session Remote refuses `file.list`, `file.read`, and `file.write` as `unsupported` without one, and the browser then shows its listing error. Leave it out of automation-only surfaces, which mount no browser half at all.

### Minimal configuration

The package takes no configuration. Mounting the row is the whole setup; the row belongs beside the other client UI rows in the Web bundle.

```yaml
- id: ui-file-browser
  name: '@deepseek-ai/dsh-client-ui-file-browser'
```

The plugin injects `slots`, `layout`, `locale`, `remote`, and `remote.session`, and fills the `conversation.details.browser` slot that `ui-chat` declares, so both packages must be mounted together for the browser to appear. The details panel renders that slot whenever no Tool call is selected, so the sidebar action only has to open the panel. A Tool view can also hand the browser one path — the read card offers it for the file its call read — and the panel opens that file directly.

<a id="model-experience"></a>
## Model Experience

### No model-facing surface

#### What the model sees

Nothing. This package calls neither `ctx.tools.register` nor `ctx.systemPrompt.section`, and appends no session events. It is a browser presentation surface: what a user reads or edits through it reaches the model only if the user or another plugin puts that content into the conversation.

#### Token effect

None. The package adds no schema, no prompt text, and no tool results, so it costs the model no tokens on any request.

#### KV Cache effect

None. Mounting or unmounting the package does not change the request prefix, so it neither improves nor invalidates KV-cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is a poor fit. They are current package constraints, not a task backlog.

- **Browsing starts at the Session workspace root and cannot walk above it.** The owner hands the browser one root; `Back` pops the trail it walked down and stops there, so a path outside the workspace is reachable only by opening a Session rooted there.
- **A symlinked child navigates to its target.** The Host resolves each listed child, so opening a symlink opens the resolved path — the browser shows the target's location, not the link's.
- **A conflict is reported, not merged.** A save carries the version the edit was based on, so a file changed on disk since it was opened is refused rather than overwritten — but resolving it means reloading and re-applying the edit by hand; there is no merge view.
- **The read ceiling is a whole-file limit.** `file.read` refuses a file over `fileReadMaxBytes` (2 MiB by default) instead of returning a prefix, so a large log cannot be inspected through this surface at all.
- **A listing is a snapshot.** Nothing re-lists a directory that changes on disk while it is open; leaving and re-entering it is what refreshes the rows.

<a id="dev-note"></a>
### Dev Note

The node half deliberately re-exports types only. Its earlier form re-exported the React components, which pulled `.module.css` imports into the node bundle and broke the build — the browser components must stay reachable only through `exports["./client"]`. `DetailsBrowser` receives its filesystem callbacks as an injected face built in `src/client/index.ts` rather than importing a Remote itself, which is what keeps the component testable and the authorizing identity with the registering entry. Listing rows are keyed by name, not path: the Host resolves each child, so a symlink and its target repeat one path within a single listing.

No runtime invariant companion is published: this Client plugin renders a slot the details panel declares and reads Session Remotes it does not own; the Host owns every relation between a listing and the filesystem.
