// Phase 8.3 deliverable: llm-qwen retry với backoff cho lỗi TRANSIENT (network
// throw, 429/5xx), KHÔNG retry lỗi 4xx khác (auth/request sai). `global.fetch`
// bị stub -- KHÔNG gọi mạng thật, cùng kỷ luật test đã dùng cho FakeLlm ở các
// phase trước (seam thật, implementation giả để cô lập logic cần verify).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as llmQwenModule from '../bundles/providers/llm-qwen/index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 5))
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function mount(config: Record<string, unknown>) {
  const root = new Context()
  const fiber = root.plugin(llmQwenModule, config)
  await settle()
  await fiber.await()
  return { root, fiber }
}

const BASE_CONFIG = { apiKey: 'k', baseUrl: 'http://fake-proxy.invalid', model: 'm', retryBaseDelayMs: 1 }

describe('Phase 8.3 — llm-qwen retry/backoff', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('503 -> 503 -> 200: retry đúng số lần mặc định (maxRetries=2 -> tối đa 3 lần gọi) rồi trả kết quả cuối', async () => {
    let calls = 0
    global.fetch = vi.fn(async () => {
      calls++
      if (calls < 3) return jsonResponse(503, {})
      return jsonResponse(200, { choices: [{ message: { content: 'ok' } }] })
    }) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.complete([{ role: 'user', content: 'hi' }])
    expect(result.content).toBe('ok')
    expect(calls).toBe(3)
    await fiber.dispose()
  })

  it('401 -> throw ngay, KHÔNG retry (request sai/auth sai fail y hệt lần nữa)', async () => {
    let calls = 0
    global.fetch = vi.fn(async () => {
      calls++
      return new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    }) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    await expect(root.llm.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401/)
    expect(calls).toBe(1)
    await fiber.dispose()
  })

  it('network error -> network error -> 200: retry cả lỗi throw TRƯỚC KHI có response (không chỉ lỗi từ status code)', async () => {
    let calls = 0
    global.fetch = vi.fn(async () => {
      calls++
      if (calls < 3) throw new TypeError('fetch failed')
      return jsonResponse(200, { choices: [{ message: { content: 'ok sau khi mạng chập chờn' } }] })
    }) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.complete([{ role: 'user', content: 'hi' }])
    expect(result.content).toBe('ok sau khi mạng chập chờn')
    expect(calls).toBe(3)
    await fiber.dispose()
  })

  it('vượt quá maxRetries -> throw lỗi cuối cùng, không lặp vô hạn', async () => {
    let calls = 0
    global.fetch = vi.fn(async () => {
      calls++
      return jsonResponse(503, {})
    }) as unknown as typeof fetch

    const { root, fiber } = await mount({ ...BASE_CONFIG, maxRetries: 1 })
    await expect(root.llm.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/503/)
    expect(calls).toBe(2) // 1 lần gốc + 1 retry (maxRetries=1)
    await fiber.dispose()
  })

  it('400 -> throw ngay, giữ error detail rút gọn nhưng che secret', async () => {
    let calls = 0
    global.fetch = vi.fn(async () => {
      calls++
      return jsonResponse(400, {
        error: {
          message: `maximum context length exceeded; Bearer private-token sk-supersecret ${'x'.repeat(900)}`,
        },
      })
    }) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const error = await root.llm.complete([{ role: 'user', content: 'hi' }]).then(
      () => { throw new Error('expected completion to reject') },
      (reason: unknown) => reason instanceof Error ? reason : new Error(String(reason)),
    )
    expect(error.message).toMatch(/400.*maximum context length exceeded/)
    expect(error.message).not.toContain('private-token')
    expect(error.message).not.toContain('sk-supersecret')
    expect(error.message.length).toBeLessThan(700)
    expect(calls).toBe(1)
    await fiber.dispose()
  })
})
