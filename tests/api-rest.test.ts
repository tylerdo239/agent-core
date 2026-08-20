// Phase 6.1 deliverable: server REST thật lắng nghe port, test gọi bằng
// `fetch` thật (không mock) — tạo session, gửi message, nhận kết quả, đọc
// lại event; mount → unmount → cổng đã đóng sạch. Cộng thêm production
// hardening: auth (API key) bắt buộc trên mọi endpoint trừ /health, /ready.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as authApiKey from '../bundles/providers/auth-apikey/index.ts'
import * as apiRest from '../bundles/adapters/api-rest/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'

const TEST_KEY = 'test-key-abc'
const AUTH_HEADER = { authorization: `Bearer ${TEST_KEY}` }

class FakeLlm extends LlmService {
  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    const userMsg = messages.find((m) => m.role === 'user')?.content ?? ''
    return { content: `trả lời cho: ${userMsg}` }
  }
}
const fakeLlm = (ctx: Context) => {
  ctx.plugin(FakeLlm)
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

async function bootApp(port = 0) {
  const root = new Context()
  root.plugin(toolRegistry)
  root.plugin(skillRegistry)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(fakeLlm)
  root.plugin(loopRegistry)
  root.plugin(loopDefault)
  root.plugin(agentRunner)
  root.plugin(sessionRegistry)
  root.plugin(authApiKey, { keys: [TEST_KEY] })
  const config: apiRest.ApiRest.Config = { port }
  const fiber = root.plugin(apiRest, config)
  // LƯU Ý: `fiber.await()` CHỈ đợi công việc load ĐANG chạy dở — nếu fiber
  // này vẫn PENDING (dependency chain của các bundle mount trước đó chưa kịp
  // hội tụ), `inertia` chưa từng được set nên `.await()` resolve ngay lập
  // tức, KHÔNG đợi gì cả (đã verify thực nghiệm — không phải giả thuyết).
  // `settle()` (1 tick timer thật) cho toàn bộ chuỗi reactive kịp hội tụ
  // trước, sau đó `fiber.await()` mới có ý nghĩa.
  await settle()
  await fiber.await()
  return { root, fiber, config }
}

let cleanup: (() => Promise<unknown>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

describe('Phase 6.1 — REST API', () => {
  it('tạo session, gửi message, đọc lại event — qua HTTP thật (có auth)', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()
    const base = `http://127.0.0.1:${config.port}`

    const health = await fetch(`${base}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })

    const ready = await fetch(`${base}/ready`)
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ ready: true })

    const createRes = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADER },
      body: JSON.stringify({ id: 'rest-1', systemPrompt: 'bạn là trợ lý' }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created).toEqual({ id: 'rest-1', driver: 'default', maxSteps: 8 })

    const msgRes = await fetch(`${base}/sessions/rest-1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADER },
      body: JSON.stringify({ message: 'xin chào' }),
    })
    expect(msgRes.status).toBe(200)
    const result = await msgRes.json()
    expect(result).toEqual({ content: 'trả lời cho: xin chào', steps: 0 })

    const eventsRes = await fetch(`${base}/sessions/rest-1/events`, { headers: AUTH_HEADER })
    expect(eventsRes.status).toBe(200)
    const { events } = await eventsRes.json()
    expect(events.map((e: any) => e.type)).toEqual(['user_message', 'model_message'])
  })

  it('404 cho session không tồn tại, 400 cho body thiếu message (có auth)', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()
    const base = `http://127.0.0.1:${config.port}`

    const notFound = await fetch(`${base}/sessions/khong-ton-tai/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADER },
      body: JSON.stringify({ message: 'hi' }),
    })
    expect(notFound.status).toBe(404)

    await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADER },
      body: JSON.stringify({ id: 'bad-body' }),
    })
    const badBody = await fetch(`${base}/sessions/bad-body/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADER },
      body: JSON.stringify({}),
    })
    expect(badBody.status).toBe(400)
  })

  it('401 khi thiếu key hoặc key sai — /health và /ready vẫn không cần key', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()
    const base = `http://127.0.0.1:${config.port}`

    expect((await fetch(`${base}/health`)).status).toBe(200)
    expect((await fetch(`${base}/ready`)).status).toBe(200)

    const noAuth = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(noAuth.status).toBe(401)

    const wrongKey = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sai-key' },
      body: JSON.stringify({}),
    })
    expect(wrongKey.status).toBe(401)
  })

  it('CORS: preflight OPTIONS trả 204 kèm header, response thật kèm Access-Control-Allow-Origin', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()
    const base = `http://127.0.0.1:${config.port}`

    const preflight = await fetch(`${base}/sessions`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8790' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization')

    const health = await fetch(`${base}/health`)
    expect(health.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('413 khi body vượt giới hạn cấu hình', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(fakeLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    root.plugin(sessionRegistry)
    root.plugin(authApiKey, { keys: [TEST_KEY] })
    const config: apiRest.ApiRest.Config = { port: 0, maxBodyBytes: 16 }
    const fiber = root.plugin(apiRest, config)
    await settle()
    await fiber.await()
    cleanup = () => fiber.dispose()

    const res = await fetch(`http://127.0.0.1:${config.port}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADER },
      body: JSON.stringify({ systemPrompt: 'chuỗi này chắc chắn dài hơn 16 byte giới hạn' }),
    })
    expect(res.status).toBe(413)
  })

  it('mount -> unmount -> cổng đóng sạch (không còn ai lắng nghe)', async () => {
    const { fiber, config } = await bootApp()
    const base = `http://127.0.0.1:${config.port}`

    expect((await fetch(`${base}/health`)).status).toBe(200)

    await fiber.dispose()

    await expect(fetch(`${base}/health`)).rejects.toThrow()
  })
})
