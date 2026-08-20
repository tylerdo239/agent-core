// Phase 6.2 deliverable: test dùng WebSocket client thật kết nối vào server
// thật (không mock socket) — gửi `send_message`, thu đủ chuỗi `step` đúng
// thứ tự rồi tới `done`, đúng bằng số event `agent/step` mà turn đó phát ra.
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as authApiKey from '../bundles/providers/auth-apikey/index.ts'
import * as apiWs from '../bundles/adapters/api-ws/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'

const TEST_KEY = 'test-key-abc'

class FakeLlm extends LlmService {
  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    const hasToolResult = messages.some((m) => m.role === 'tool')
    if (!hasToolResult) {
      return { content: 'tra dữ liệu', toolCall: { name: 'echo', args: { text: 'hi' } } }
    }
    return { content: 'xong rồi' }
  }
}
const fakeLlm = (ctx: Context) => {
  ctx.plugin(FakeLlm)
}
const echoTool = Object.assign(
  (ctx: Context) => {
    // Phase 8.5: `ui` khai ở đây để test dưới xác nhận `toolUi` đi xuyên
    // suốt loop-default -> agent/step -> WS JSON, không suy đoán.
    ctx.tools.add({ name: 'echo', description: 'echo', ui: { icon: '🔁', label: 'Echo' }, async handler(args) { return args } })
  },
  { inject: ['tools'] },
)

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

async function bootApp() {
  const root = new Context()
  root.plugin(toolRegistry)
  root.plugin(skillRegistry)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(echoTool)
  root.plugin(fakeLlm)
  root.plugin(loopRegistry)
  root.plugin(loopDefault)
  root.plugin(agentRunner)
  root.plugin(sessionRegistry)
  root.plugin(authApiKey, { keys: [TEST_KEY] })
  const config: apiWs.ApiWs.Config = { port: 0 }
  const fiber = root.plugin(apiWs, config)
  await settle()
  await fiber.await()
  return { root, fiber, config }
}

function connect(port: number, authorization = `Bearer ${TEST_KEY}`) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authorization ? { authorization } : {} })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

// Queue-based collector — KHÔNG dùng ws.once('message') tuần tự: server có
// thể gửi nhiều message dồn dập (step -> step -> done) nhanh hơn tốc độ
// vòng lặp test kịp await/re-attach listener, làm mất message. Đăng ký 1
// listener DUY NHẤT, thường trực, đẩy vào hàng đợi; consumer chỉ lấy ra.
function messageQueue(ws: WebSocket) {
  const queue: any[] = []
  const waiters: ((msg: any) => void)[] = []
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    const waiter = waiters.shift()
    if (waiter) waiter(msg)
    else queue.push(msg)
  })
  return {
    next(): Promise<any> {
      if (queue.length) return Promise.resolve(queue.shift())
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}

let cleanup: (() => Promise<unknown>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

describe('Phase 6.2 — WebSocket streaming', () => {
  it('create_session -> send_message -> stream đủ step đúng thứ tự -> done', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()

    const ws = await connect(config.port!)
    const queue = messageQueue(ws)
    try {
      ws.send(JSON.stringify({ type: 'create_session' }))
      const created = await queue.next()
      expect(created.type).toBe('session_created')
      expect(created.driver).toBe('default')
      const sessionId = created.id

      ws.send(JSON.stringify({ type: 'send_message', sessionId, message: 'chào' }))

      const messages: any[] = []
      while (true) {
        const m = await queue.next()
        messages.push(m)
        if (m.type === 'done' || m.type === 'error') break
      }

      // loop-default emit 'model_message' MỖI vòng lặp (tool-call hay không),
      // và emit thêm 'final' riêng khi model không gọi tool nữa — xem
      // bundles/loop-default. Nên turn có 1 tool call = 4 step + 1 done.
      expect(messages.map((m) => m.type)).toEqual(['step', 'step', 'step', 'step', 'done'])
      expect(messages[0].step).toEqual({
        type: 'model_message',
        content: 'tra dữ liệu',
        toolCall: { name: 'echo', args: { text: 'hi' } },
        toolUi: { icon: '🔁', label: 'Echo' },
      })
      expect(messages[1].step).toEqual({ type: 'tool_result', name: 'echo', result: { text: 'hi' }, toolUi: { icon: '🔁', label: 'Echo' } })
      expect(messages[2].step).toEqual({ type: 'model_message', content: 'xong rồi', toolCall: undefined })
      expect(messages[3].step).toEqual({ type: 'final', content: 'xong rồi' })
      expect(messages[4].result).toEqual({ content: 'xong rồi', steps: 1 })
      for (const m of messages) expect(m.sessionId).toBe(sessionId)
    } finally {
      ws.close()
    }
  })

  it('session không tồn tại -> trả error, không crash server', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()

    const ws = await connect(config.port!)
    const queue = messageQueue(ws)
    try {
      ws.send(JSON.stringify({ type: 'send_message', sessionId: 'khong-ton-tai', message: 'x' }))
      const err = await queue.next()
      expect(err.type).toBe('error')
    } finally {
      ws.close()
    }
  })

  it('handshake bị từ chối (401) khi thiếu key hoặc key sai — trước khi nâng cấp lên WebSocket', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()

    await expect(connect(config.port!, '')).rejects.toThrow(/401/)
    await expect(connect(config.port!, 'Bearer sai-key')).rejects.toThrow(/401/)
  })

  it('auth qua query string (?key=...) — cách duy nhất browser thật dùng được, không qua header', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()

    // Không set header authorization — mô phỏng đúng `new WebSocket(url)`
    // của trình duyệt, không có tham số headers.
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${config.port}/?key=${encodeURIComponent(TEST_KEY)}`)
      socket.once('open', () => resolve(socket))
      socket.once('error', reject)
    })
    const queue = messageQueue(ws)
    ws.send(JSON.stringify({ type: 'create_session' }))
    const created = await queue.next()
    expect(created.type).toBe('session_created')
    ws.close()

    await expect(
      new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${config.port}/?key=sai-key`)
        socket.once('open', () => resolve(socket))
        socket.once('error', reject)
      }),
    ).rejects.toThrow(/401/)
  })

  it('mount -> unmount -> cổng đóng sạch', async () => {
    const { fiber, config } = await bootApp()

    const ws = await connect(config.port!)
    ws.close()
    await settle()

    await fiber.dispose()

    await expect(connect(config.port!)).rejects.toThrow()
  })
})
