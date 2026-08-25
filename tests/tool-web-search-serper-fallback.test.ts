// tests/tool-web-search-serper-fallback.test.ts — user đăng ký serper.dev,
// muốn làm provider CHÍNH cho web_search, DuckDuckGo chỉ dự phòng khi Serper
// lỗi/hết hạn mức (xem bundles/tools/tool-web-search/index.ts). `global.fetch`
// bị stub — không gọi mạng thật, cùng kỷ luật tests/tool-web-search-timeout.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as toolWebSearch from '../bundles/tools/tool-web-search/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

async function bootApp(config: Parameters<typeof toolWebSearch.apply>[1] = {}) {
  const root = new Context()
  root.plugin(toolRegistry)
  root.plugin(promptRegistry)
  root.plugin(permissionRbac, { rules: { 'web-search': ['search'] } })
  root.plugin(toolWebSearch, config)
  await settle()
  return root
}

const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg-example.com&rut=x">DDG Title</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg-example.com">DDG Snippet</a>
</div>
`

const SERPER_JSON = {
  organic: [{ title: 'Serper Title', link: 'https://serper-example.com', snippet: 'Serper Snippet' }],
}

describe('tool-web-search — Serper.dev chính, DuckDuckGo tự dự phòng', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('không set serperApiKey -> chỉ gọi DuckDuckGo (tương thích ngược hoàn toàn), provider="duckduckgo"', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(DDG_HTML, { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const root = await bootApp()
    const tool = root.tools.get('web_search')!
    const result = (await tool.handler({ query: 'x' }, { sessionId: 's1', source: 'default-loop' })) as {
      provider: string
      results: Array<{ title: string; url: string }>
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('duckduckgo.com')
    expect(result.provider).toBe('duckduckgo')
    expect(result.results).toEqual([{ title: 'DDG Title', url: 'https://ddg-example.com', snippet: 'DDG Snippet' }])
  })

  it('có serperApiKey, Serper thành công -> CHỈ gọi Serper (không fallback), provider="serper"', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(SERPER_JSON), { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const root = await bootApp({ serperApiKey: 'test-key' })
    const tool = root.tools.get('web_search')!
    const result = (await tool.handler({ query: 'x' }, { sessionId: 's1', source: 'default-loop' })) as {
      provider: string
      results: Array<{ title: string; url: string; snippet: string }>
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://google.serper.dev/search')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key')
    expect(result.provider).toBe('serper')
    expect(result.results).toEqual([{ title: 'Serper Title', url: 'https://serper-example.com', snippet: 'Serper Snippet' }])
  })

  it('có serperApiKey nhưng Serper lỗi mạng -> fallback DuckDuckGo NGAY, provider="duckduckgo"', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(DDG_HTML, { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const root = await bootApp({ serperApiKey: 'test-key' })
    const tool = root.tools.get('web_search')!
    const result = (await tool.handler({ query: 'x' }, { sessionId: 's1', source: 'default-loop' })) as { provider: string }

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://google.serper.dev/search')
    expect(String(fetchMock.mock.calls[1][0])).toContain('duckduckgo.com')
    expect(result.provider).toBe('duckduckgo')
  })

  it('Serper trả 429 (hết hạn mức) -> fallback DuckDuckGo, KHÔNG retry Serper', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(DDG_HTML, { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const root = await bootApp({ serperApiKey: 'test-key' })
    const tool = root.tools.get('web_search')!
    const result = (await tool.handler({ query: 'x' }, { sessionId: 's1', source: 'default-loop' })) as { provider: string }

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.provider).toBe('duckduckgo')
  })

  it('serperBaseUrl override (test) -> Serper gọi đúng URL override, không phải endpoint thật', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(SERPER_JSON), { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const root = await bootApp({ serperApiKey: 'test-key', serperBaseUrl: 'https://fake-serper.test/search' })
    const tool = root.tools.get('web_search')!
    await tool.handler({ query: 'x' }, { sessionId: 's1', source: 'default-loop' })

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://fake-serper.test/search')
  })
})
