/**
 * Drives the real provider against a stubbed `fetch`: the request it builds,
 * the vocabulary it maps Brave's response into, and how it classifies every
 * failure the seam distinguishes. The plugin section mounts the real body on a
 * real `ctx.web` so registration, config defaults, and disposal are exercised
 * through the seam rather than by reading `apply`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as bravePlugin from '@deepseek-ai/dsh-web-search-brave'
import {
  BRAVE_DEFAULT_API_ENDPOINT,
  BRAVE_PROVIDER_ID,
  BraveSearchProvider,
  mapBraveResponse,
  mapBraveResult,
} from '../src/provider.ts'

const options = { apiKey: 'brave-key', endpoint: 'https://api.brave.test/search' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Brave result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapBraveResult({
      url: 'https://a.test',
      title: 'A',
      description: 'a snippet',
      metadata: { publishedDate: '2026-01-01' },
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'a snippet', publishedAt: '2026-01-01' })
  })

  it('keeps a result whose only usable field is its url', () => {
    expect(mapBraveResult({ url: 'https://a.test', title: '' })).toEqual({ url: 'https://a.test' })
  })

  it('omits null and empty optional fields rather than emitting them', () => {
    expect(mapBraveResult({ url: 'https://a.test', title: '', description: null, metadata: null }))
      .toEqual({ url: 'https://a.test' })
    expect(mapBraveResult({ url: 'https://a.test', title: '', description: '', metadata: { publishedDate: '' } }))
      .toEqual({ url: 'https://a.test' })
    expect(mapBraveResult({ url: 'https://a.test', title: '', metadata: { publishedDate: null } }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps a response to sources in order, with no provider-generated content', () => {
    const result = mapBraveResponse({
      web: {
        results: [
          { url: 'https://a.test', title: 'A' },
          { url: 'https://b.test', title: 'B', description: 'second' },
        ],
      },
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', title: 'A' },
        { url: 'https://b.test', title: 'B', snippet: 'second' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a response carrying no web block', () => {
    expect(mapBraveResponse({}).sources).toEqual([])
    expect(mapBraveResponse({ web: null }).sources).toEqual([])
  })
})

describe('BraveSearchProvider availability', () => {
  it('is unavailable without a key', () => {
    expect(new BraveSearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key and a parseable endpoint', () => {
    expect(new BraveSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the endpoint is unparseable', () => {
    expect(new BraveSearchProvider({ ...options, endpoint: 'not a url' }).available()).toBe(false)
  })
})

describe('BraveSearchProvider request mapping', () => {
  it('sends the query and subscription-token auth on a GET', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    await new BraveSearchProvider(options).search({ query: 'hello world' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.brave.test/search?q=hello+world')
    expect(init).toMatchObject({ method: 'GET' })
    const headers = init.headers as Record<string, string>
    expect(headers['X-Subscription-Token']).toBe('brave-key')
    expect(headers.Accept).toBe('application/json')
  })

  it('sends count only when a default result number is configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    await new BraveSearchProvider(options).search({ query: 'q' })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).not.toContain('count=')

    await new BraveSearchProvider({ ...options, numResults: 7 }).search({ query: 'q' })
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toContain('count=7')
  })

  // The seam's own `maxResults` is applied to the returned sources by the web
  // service, so the provider never narrows the upstream request by it.
  it('does not translate a request maxResults into count', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    await new BraveSearchProvider(options).search({ query: 'q', maxResults: 2 })

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).not.toContain('count=')
  })

  it('forwards the abort signal, and omits it when the caller passes none', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await new BraveSearchProvider(options).search({ query: 'q' }, controller.signal)
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(controller.signal)

    await new BraveSearchProvider(options).search({ query: 'q' })
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]).not.toHaveProperty('signal')
  })
})

describe('BraveSearchProvider error handling', () => {
  it('prefers the provider message nested under error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'bad key' } }, { status: 401 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('falls back to a top-level message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'rate limited' }, { status: 429 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'rate limited' }))
  })

  it('keeps the status line when the error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Brave API error (HTTP 500)' }))
  })

  it('keeps the status line when the error body is empty text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: '' } }, { status: 503 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Brave API error (HTTP 503)' }))
  })

  it('keeps the status line when the error body is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Brave API error (HTTP 502)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort during the request to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-brave plugin registration', () => {
  it('registers the provider into ctx.web and releases it on disposal (HMR safety)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ web: { results: [] } })))
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      const fiber = await ctx.plugin(bravePlugin, { apiKey: 'brave-key' })

      await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })

      await fiber.dispose()
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in bravePlugin).toBe(false)
  })

  it('defaults the endpoint to the public API and threads numResults through', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      await ctx.plugin(bravePlugin, { apiKey: 'brave-key', numResults: 9 })

      await ctx.web.search({ query: 'q' })

      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url.startsWith(BRAVE_DEFAULT_API_ENDPOINT)).toBe(true)
      expect(url).toContain('count=9')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('honours a configured endpoint over the default', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      await ctx.plugin(bravePlugin, { apiKey: 'k', endpoint: 'https://mirror.test/search' })

      await ctx.web.search({ query: 'q' })

      expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('https://mirror.test/search')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('falls back to $BRAVE_API_KEY when config omits the key', async () => {
    const previous = process.env.BRAVE_API_KEY
    process.env.BRAVE_API_KEY = 'env-key'
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      await ctx.plugin(bravePlugin, {})

      await ctx.web.search({ query: 'q' })

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('env-key')
    } finally {
      await ctx.fiber.dispose()
      if (previous === undefined) delete process.env.BRAVE_API_KEY
      else process.env.BRAVE_API_KEY = previous
    }
  })

  it('is unavailable when neither config nor environment supplies a key', async () => {
    const previous = process.env.BRAVE_API_KEY
    delete process.env.BRAVE_API_KEY
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      await ctx.plugin(bravePlugin, {})

      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      await ctx.fiber.dispose()
      if (previous !== undefined) process.env.BRAVE_API_KEY = previous
    }
  })
})
