// tests/memory-tencentdb.test.ts — Phase memory: seam ctx.memory ↔ MemoryCore.
//
// `global.fetch` bị stub -- KHÔNG gọi MemoryCore thật, cùng kỷ luật đã dùng
// cho tests/tool-web-search-timeout.test.ts (seam thật, transport giả để cô
// lập đúng logic cần verify). SDK's HttpTransport (đã đọc source thật ở
// node_modules/@tencentdb-agent-memory/memory-sdk-ts-v2/dist/http.js) dùng
// native `fetch` -- stub `global.fetch` là đủ, không cần mock riêng ở tầng SDK.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memoryTencentdb from '../bundles/providers/memory-tencentdb/index.ts'
import type { MemoryTencentdb } from '../bundles/providers/memory-tencentdb/index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

function envelope(data: unknown) {
  return { code: 0, message: 'ok', request_id: 'req-1', data }
}

async function bootApp(overrides: Partial<MemoryTencentdb.Config> = {}) {
  const root = new Context()
  root.plugin(memoryTencentdb, {
    endpoint: 'http://memory-core.local',
    apiKey: 'test-key',
    serviceId: 'svc-1',
    ...overrides,
  })
  await settle()
  return root
}

describe('memory-tencentdb', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('remember() thành công -> gọi addConversation với đúng body (team_id/agent_id/user_id/session_id/messages)', async () => {
    const calls: Array<{ url: string; body: any }> = []
    global.fetch = (async (url: string, opts: RequestInit) => {
      calls.push({ url, body: JSON.parse(opts.body as string) })
      return new Response(JSON.stringify(envelope({ accepted_ids: ['m1'], total_count: 1 })), { status: 200 })
    }) as unknown as typeof fetch

    const root = await bootApp()
    await root.memory.remember('s1', 'hello world', { userId: 'alice' })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/v3/conversation/add')
    expect(calls[0].body).toMatchObject({
      team_id: 'agent-core',
      agent_id: 'default',
      user_id: 'alice',
      session_id: 's1',
      messages: [{ role: 'user', content: 'hello world' }],
    })
  })

  it('recall() thành công -> map đúng field id/text/score từ searchConversation', async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify(
          envelope({
            messages: [
              {
                id: 'm1',
                role: 'user',
                content: 'nhớ: thích cà phê đen',
                timestamp: '2026-01-01T00:00:00Z',
                score: 0.87,
              },
            ],
          }),
        ),
        { status: 200 },
      )) as unknown as typeof fetch

    const root = await bootApp()
    const result = await root.memory.recall('s1', 'cà phê', 3, { userId: 'alice' })

    expect(result).toEqual([{ id: 'm1', text: 'nhớ: thích cà phê đen', score: 0.87 }])
  })

  it('MemoryCore treo quá timeoutMs -> recall() trả mảng rỗng, KHÔNG throw', async () => {
    // fetch không bao giờ tự resolve -- chỉ "trả lời" khi signal bị abort,
    // đúng hành vi thật của AbortController (SDK's HttpTransport tự dựng
    // controller này quanh mỗi fetch(), đã verify source thật -- xem chú
    // thích đầu file provider).
    global.fetch = ((_url: string, opts: RequestInit) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })) as unknown as typeof fetch

    const root = await bootApp({ timeoutMs: 20 })
    const result = await root.memory.recall('s1', 'q', 3, { userId: 'alice' })
    expect(result).toEqual([])
  })

  it('MemoryCore treo quá timeoutMs -> remember() không throw (log-and-swallow, không chặn turn)', async () => {
    global.fetch = ((_url: string, opts: RequestInit) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })) as unknown as typeof fetch

    const root = await bootApp({ timeoutMs: 20 })
    await expect(root.memory.remember('s1', 'text', { userId: 'alice' })).resolves.toBeUndefined()
  })

  it('MemoryCore trả lỗi HTTP (500) -> recall() trả mảng rỗng, KHÔNG throw', async () => {
    global.fetch = (async () => new Response('internal error', { status: 500 })) as unknown as typeof fetch

    const root = await bootApp()
    const result = await root.memory.recall('s1', 'q')
    expect(result).toEqual([])
  })

  it('scoping theo userId: withIsolation() đổi đúng user_id gửi lên network cho từng lần gọi', async () => {
    const calls: any[] = []
    global.fetch = (async (_url: string, opts: RequestInit) => {
      calls.push(JSON.parse(opts.body as string))
      return new Response(JSON.stringify(envelope({ messages: [] })), { status: 200 })
    }) as unknown as typeof fetch

    const root = await bootApp()
    await root.memory.recall('s1', 'q', 3, { userId: 'alice' })
    await root.memory.recall('s1', 'q', 3, { userId: 'bob' })
    await root.memory.recall('s1', 'q', 3) // không truyền context -> fallback 'anonymous'

    expect(calls[0].user_id).toBe('alice')
    expect(calls[1].user_id).toBe('bob')
    expect(calls[2].user_id).toBe('anonymous')
  })

  it('không set teamId/agentId -> dùng default "agent-core"/"default"', async () => {
    const calls: any[] = []
    global.fetch = (async (_url: string, opts: RequestInit) => {
      calls.push(JSON.parse(opts.body as string))
      return new Response(JSON.stringify(envelope({ accepted_ids: [], total_count: 0 })), { status: 200 })
    }) as unknown as typeof fetch

    const root = await bootApp()
    await root.memory.remember('s1', 'x')

    expect(calls[0].team_id).toBe('agent-core')
    expect(calls[0].agent_id).toBe('default')
  })
})
