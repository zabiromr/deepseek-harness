/**
 * Wire types for the Brave Search API.
 * @module @deepseek-ai/dsh-web-search-brave/types
 */

/** One structured result from a Brave Search API response. */
export interface BraveSearchResult {
  title: string
  url: string
  description?: string | null
  metadata?: {
    publishedDate?: string | null
    countryCode?: string | null
  } | null
}

/** Brave Search API response envelope. */
export interface BraveSearchResponse {
  web?: {
    results: BraveSearchResult[]
  } | null
  search?: {
    profile_name?: string
  } | null
}

/** Brave Search API error response. */
export interface BraveSearchError {
  error?: {
    message?: string
    type?: string
  }
  message?: string
}
