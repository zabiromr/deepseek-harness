/**
 * Brave Search API provider for the web capability seam (ctx.web).
 * Calls the official Brave Search API and maps results to the normalized
 * WebSearchResult vocabulary.
 * @module @deepseek-ai/dsh-web-search-brave/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { BraveSearchError, BraveSearchResult, BraveSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const BRAVE_PROVIDER_ID = 'brave'

/** Default Brave Search endpoint. */
export const BRAVE_DEFAULT_API_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface BraveSearchProviderOptions {
  /** Brave API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** API endpoint; defaults to the public Brave Search API. */
  endpoint: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
}

/**
 * Map one Brave Search result to a normalized source.
 *
 * @param result - one entry of the response's `web.results[]`.
 * @returns the normalized source; blank fields are omitted.
 */
export function mapBraveResult(result: BraveSearchResult): WebSearchSource {
  const title = result.title.length > 0 ? result.title : undefined
  const snippet = result.description != null && result.description.length > 0 ? result.description : undefined
  const publishedAt = result.metadata?.publishedDate != null && result.metadata.publishedDate.length > 0
    ? result.metadata.publishedDate
    : undefined
  return {
    url: result.url,
    ...title != null ? { title } : {},
    ...snippet != null ? { snippet } : {},
    ...publishedAt != null ? { publishedAt } : {},
  }
}

/**
 * Map a Brave Search API response to a normalized search result.
 * The API returns structured results with title, URL, and description.
 *
 * @param response - the parsed API response body.
 * @returns the normalized result; `content` is omitted when no answer text exists.
 */
export function mapBraveResponse(response: BraveSearchResponse): WebSearchResult {
  const results = response.web?.results ?? []
  const sources = results.map(mapBraveResult)
  return {
    sources,
    truncated: false,
  }
}

/** The Brave Search-backed search provider; HTTP redirects are followed. */
export class BraveSearchProvider implements WebSearchProvider {
  readonly id = BRAVE_PROVIDER_ID

  constructor(private readonly options: BraveSearchProviderOptions) {}

  /* jscpd:ignore-start */
  available(): boolean {
    return this.options.apiKey.length > 0 && URL.canParse(this.options.endpoint)
  }
  /* jscpd:ignore-end */

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const params = new URLSearchParams()
    params.set('q', request.query)
    if (this.options.numResults !== undefined) params.set('count', String(this.options.numResults))

    let response: Response
    try {
      response = await fetch(`${this.options.endpoint}?${params}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'en',
          'X-Subscription-Token': this.options.apiKey,
          'User-Agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Brave API error (HTTP ${status})`
      try {
        const parsed = await response.json() as BraveSearchError
        const detail = parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch {
        // HTTP status is already captured; a malformed body only costs a richer message.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as BraveSearchResponse
      return mapBraveResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** Check whether an error is an abort (DOMException named AbortError). */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
