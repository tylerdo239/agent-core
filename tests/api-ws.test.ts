// Phase 6.2 deliverable: test dùng WebSocket client thật kết nối vào server
// thật (không mock socket) — gửi `send_message`, thu đủ chuỗi `step` đúng
// thứ tự rồi tới `done`, đúng bằng số event `agent/step` mà turn đó phát ra.
//
// Module auth (nhiều người dùng thật): xem tests/api-rest.test.ts cho giải
// thích đầy đủ về pattern Postgres-per-test-database + lý do settle() 100ms
// (10ms cũ chỉ đủ cho provider đồng bộ, auth-users giờ làm I/O mạng thật).
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { Context } from '@deepseek-ai/cordis'
import pg from 'pg'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as authUsers from '../bundles/providers/auth-users/index.ts'
import * as apiWs from '../bundles/adapters/api-ws/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:test@127.0.0.1:5433/agent_core_test'

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
    ctx.tools.add({ name: 'echo', description: 'echo', ui: { icon: '🔁', label: 'Echo' }, async handler(args) { return args } })
  },
  { inject: ['tools'] },
)

async function settle() {
  // Xem giải thích đầy đủ ở tests/api-rest.test.ts — auth-users làm I/O
  // Postgres thật, 10ms cũ (đủ cho provider đồng bộ) không đủ cho fiber
  // chain hội tụ trước khi fiber.await() coi là xong.
  await new Promise((r) => setTimeout(r, 100))
}

const adminUrl = new URL(DATABASE_URL)
adminUrl.pathname = '/postgres'
const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 })

let cleanup: (() => Promise<unknown>) | undefined

async function withFreshSchemaUrl<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const dbName = `test_${randomUUID().replace(/-/g, '')}`
  await admin.query(`CREATE DATABASE "${dbName}"`)
  const testUrl = new URL(DATABASE_URL)
  testUrl.pathname = `/${dbName}`
  try {
    return await fn(testUrl.toString())
  } finally {
    await cleanup?.()
    cleanup = undefined
  }
}

async function bootApp(databaseUrl: string) {
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
  root.plugin(permissionRbac, { rules: { admin: ['admin:users:manage'] } })
  root.plugin(authUsers, { connectionString: databaseUrl })
  const config: apiWs.ApiWs.Config = { port: 0 }
  const fiber = root.plugin(apiWs, config)
  await settle()
  await fiber.await()
  return { root, fiber, config }
}

// api-ws KHÔNG có endpoint HTTP nào (chỉ nâng cấp lên WebSocket) — gọi thẳng
// ctx.auth.signup() trên root, không phải fetch qua HTTP (không có route
// nào cho việc đó ở cổng WS cả).
async function signup(root: Context, username: string, password = 'correcthorse123'): Promise<string> {
  const { token } = await root.auth.signup(username, password)
  return token
}

function connect(port: number, authorization?: string) {
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

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

describe('Phase 6.2 — WebSocket streaming', () => {
  it('create_session -> send_message -> stream đủ step đúng thứ tự -> done', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const token = await signup(root, 'alice')

      const ws = await connect(config.port!, `Bearer ${token}`)
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
  })

  it('session không tồn tại -> trả error, không crash server', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const token = await signup(root, 'alice')

      const ws = await connect(config.port!, `Bearer ${token}`)
      const queue = messageQueue(ws)
      try {
        ws.send(JSON.stringify({ type: 'send_message', sessionId: 'khong-ton-tai', message: 'x' }))
        const err = await queue.next()
        expect(err.type).toBe('error')
      } finally {
        ws.close()
      }
    })
  })

  it('handshake bị từ chối (401) khi thiếu token hoặc token sai — trước khi nâng cấp lên WebSocket', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()

      await expect(connect(config.port!, undefined)).rejects.toThrow(/401/)
      await expect(connect(config.port!, 'Bearer sai-token')).rejects.toThrow(/401/)
    })
  })

  it('auth qua query string (?token=...) — cách duy nhất browser thật dùng được, không qua header', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const token = await signup(root, 'alice')

      // Không set header authorization — mô phỏng đúng `new WebSocket(url)`
      // của trình duyệt, không có tham số headers.
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${config.port}/?token=${encodeURIComponent(token)}`)
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
          const socket = new WebSocket(`ws://127.0.0.1:${config.port}/?token=sai-token`)
          socket.once('open', () => resolve(socket))
          socket.once('error', reject)
        }),
      ).rejects.toThrow(/401/)
    })
  })

  it('gap thật đã sửa: user KHÁC không gửi message vào session không phải của mình (error, không phải crash)', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const aliceToken = await signup(root, 'alice')
      const bobToken = await signup(root, 'bob')

      const aliceWs = await connect(config.port!, `Bearer ${aliceToken}`)
      const aliceQueue = messageQueue(aliceWs)
      aliceWs.send(JSON.stringify({ type: 'create_session' }))
      const { id: sessionId } = await aliceQueue.next()
      aliceWs.close()

      const bobWs = await connect(config.port!, `Bearer ${bobToken}`)
      const bobQueue = messageQueue(bobWs)
      try {
        bobWs.send(JSON.stringify({ type: 'send_message', sessionId, message: 'x' }))
        const err = await bobQueue.next()
        expect(err.type).toBe('error')
        expect(err.message).toBe('forbidden')
      } finally {
        bobWs.close()
      }
    })
  })

  it('mount -> unmount -> cổng đóng sạch', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      const token = await signup(root, 'alice')

      const ws = await connect(config.port!, `Bearer ${token}`)
      ws.close()
      await new Promise((r) => setTimeout(r, 10))

      await fiber.dispose()

      await expect(connect(config.port!, `Bearer ${token}`)).rejects.toThrow()
    })
  })
})
