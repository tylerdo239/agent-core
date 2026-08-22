// Gap thật phát hiện qua audit đối chiếu docs/agent-core-master-summary.md
// (mục "timeout riêng từng tool" — chưa build): fetch() gọi DuckDuckGo KHÔNG
// có timeout, có thể treo cả turn vô thời hạn nếu DuckDuckGo không phản hồi.
// `global.fetch` bị stub — KHÔNG gọi mạng thật, cùng kỷ luật đã dùng cho
// tests/llm-qwen-retry.test.ts (seam thật, implementation giả để cô lập
// đúng logic timeout cần verify).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as toolWebSearch from '../bundles/tools/tool-web-search/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

async function bootApp(timeoutMs: number) {
  const root = new Context()
  root.plugin(toolRegistry)
  root.plugin(promptRegistry)
  root.plugin(permissionRbac, { rules: { 'web-search': ['search'] } })
  root.plugin(toolWebSearch, { timeoutMs })
  await settle()
  return root
}

describe('Phase 11 (audit fix) — tool-web-search timeout', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('DuckDuckGo treo quá timeoutMs -> throw lỗi timeout rõ ràng, KHÔNG treo vô thời hạn', async () => {
    // fetch không bao giờ tự resolve -- chỉ "trả lời" khi signal bị abort,
    // đúng hành vi thật của AbortController truyền vào fetch.
    global.fetch = ((_url: string, opts: RequestInit) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })) as unknown as typeof fetch

    const root = await bootApp(20)
    const tool = root.tools.get('web_search')!
    await expect(tool.handler({ query: 'test' })).rejects.toThrow(/timeout sau 20ms/)
  })

  it('response về TRƯỚC timeout -> hoạt động bình thường, không bị abort oan', async () => {
    global.fetch = (async () => new Response('<html></html>', { status: 200 })) as unknown as typeof fetch

    const root = await bootApp(5000)
    const tool = root.tools.get('web_search')!
    const result = (await tool.handler({ query: 'giá vàng' })) as { query: string; results: unknown[] }
    expect(result.query).toBe('giá vàng')
    expect(result.results).toEqual([])
  })

  it('không set timeoutMs -> dùng default 10s (không throw sớm hơn khi response về nhanh)', async () => {
    global.fetch = (async () => new Response('<html></html>', { status: 200 })) as unknown as typeof fetch

    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(promptRegistry)
    root.plugin(permissionRbac, { rules: { 'web-search': ['search'] } })
    root.plugin(toolWebSearch) // không truyền config
    await settle()

    const tool = root.tools.get('web_search')!
    const result = (await tool.handler({ query: 'x' })) as { query: string }
    expect(result.query).toBe('x')
  })
})
