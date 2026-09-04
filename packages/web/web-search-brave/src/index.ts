/**
 * Brave Search-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-search-brave
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  BraveSearchProvider,
  BRAVE_DEFAULT_API_ENDPOINT,
} from './provider.ts'

export {
  BRAVE_DEFAULT_API_ENDPOINT,
  BRAVE_PROVIDER_ID,
  BraveSearchProvider,
} from './provider.ts'
export type { BraveSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-brave'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Brave API key. Falls back to `$BRAVE_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** API endpoint; defaults to the public Brave Search API. */
  endpoint?: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  endpoint: z.string(),
  numResults: z.number().step(1).min(1),
})

/** Register the Brave search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new BraveSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('BRAVE_API_KEY')?.value ?? '',
    endpoint: config.endpoint ?? BRAVE_DEFAULT_API_ENDPOINT,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }))
}

