---
description: "The Brave Search-backed provider for ctx.web: how deployments mount Brave Search with structured sources and metadata."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-brave

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-brave`, the harness searches the web through [Brave Search](https://brave.com/search/api/) and gets structured sources with title, URL, snippet, and publication date. Choose this backend when a deployment holds a Brave Search API key and wants clean, metadata-rich results without a generated answer. The model-facing `web_search` tool lives in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `brave` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: brave`.

### When to choose it

Choose this backend when a deployment holds a Brave Search API key and wants metadata-rich, structured results. Brave Search returns title, URL, snippet, and optional publication date for every source. The provider is unavailable when the API key is empty or the endpoint base does not parse.

### Minimal configuration

Load the web service and the provider; the API key falls back to `$BRAVE_API_KEY` from the launch environment, and all other settings have safe defaults.

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-web-search-brave'
  config:
    apiKey: !!js process.env.BRAVE_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | `$BRAVE_API_KEY` | Brave Search API key; empty or absent makes the provider unavailable |
| `endpoint` | `https://api.search.brave.com/res/v1/web/search` | API endpoint. An unparseable value makes the provider unavailable |
| `numResults` | (unset) | Default result count for search requests |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-brave) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

`sources[]` carries structured results with `url`, `title`, `snippet`, and `publishedAt`. Brave Search has no generated answer field, so `content` is omitted. The service enforces `maxResults` by truncating and flagging.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over the Brave Search API with one rule:

- **Structured results are the contract.** Every Brave Search result carries `title`, `url`, and `description`; `publishedDate` is optional. The provider maps these directly to the normalized `WebSearchSource` shape.

### Source map

| File | Role |
|---|---|
| `[src/index.ts](src/index.ts)` | Plugin entry: config schema, environment fallback, provider registration |
| `[src/provider.ts](src/provider.ts)` | The `BraveSearchProvider`: request dispatch, abort classification, result mapping |
| `[src/types.ts](src/types.ts)` | Brave Search wire types for the API response |

### Request and mapping flow

`search()` sends a GET to the Brave endpoint with `q` (the query), `count` (result limit), and the `X-Subscription-Token` header. Each `web.results[]` entry maps to a `WebSearchSource` with `url`, `title`, `snippet`, and `publishedAt`. The service applies the final `maxResults` bound on the way back.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the six-package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-brave) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

### Auxiliary Brave request

#### What the model sees

A separate Brave Search API call receives `<query>` as its `q` parameter. This request is not part of the conversation model's context.

#### Token effect

Zero direct conversation tokens for registration. Source tokens are data-dependent, source count is service-bounded, and the retained result is resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit. They are current package constraints.

- **No generated answer** — Brave Search returns only structured sources; `content` is always omitted, so there is no provider-generated summary or answer text.
- **Publication dates are sparse** — `publishedAt` is optional and not all results include it; sources without it simply omit the field.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: Brave content cache endpoint

Brave Search offers a `/search/web` cached content endpoint. Adding it as a `WebFetchProvider` would require a new `web-search-brave-fetch` package or extending this one.

</details>

No runtime invariant companion is published: this provider maps one external HTTP response into the service's result type; the bounds and abort semantics belong to the service that calls it.
