// Phase 6.3 deliverable: test dùng gRPC client thật (@grpc/grpc-js) gọi
// CreateSession/SendMessage/StreamTurn vào server thật — không mock transport.
//
// Module auth (nhiều người dùng thật): xem tests/api-rest.test.ts cho giải
// thích đầy đủ về pattern Postgres-per-test-database + lý do settle() 100ms.
// api-grpc không có RPC riêng cho signup/login (chủ đích — xem header file
// bundles/adapters/api-grpc) nên gọi thẳng ctx.auth.signup() trên root.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
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
import * as apiGrpc from '../bundles/adapters/api-grpc/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:test@127.0.0.1:5433/agent_core_test'

function authMeta(token: string) {
  const meta = new grpc.Metadata()
  meta.set('authorization', `Bearer ${token}`)
  return meta
}

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
  // Xem giải thích đầy đủ ở tests/api-rest.test.ts.
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
  root.plugin(promptRegistry)
  root.plugin(promptDefaultAgent)
  root.plugin(contextCompactorLlm)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(echoTool)
  root.plugin(fakeLlm)
  root.plugin(loopRegistry)
  root.plugin(loopDefault)
  root.plugin(agentRunner)
  root.plugin(sessionRegistry)
  root.plugin(permissionRbac, { rules: { admin: ['admin:users:manage'] } })
  root.plugin(authUsers, { connectionString: databaseUrl })
  const config: apiGrpc.ApiGrpc.Config = { port: 0 }
  const fiber = root.plugin(apiGrpc, config)
  await settle()
  await fiber.await()
  return { root, fiber, config }
}

async function signup(root: Context, username: string, password = 'correcthorse123'): Promise<string> {
  const { token } = await root.auth.signup(username, password)
  return token
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTO_PATH = path.join(__dirname, '../bundles/adapters/api-grpc/agent.proto')

function makeClient(port: number) {
  const packageDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
  const proto = grpc.loadPackageDefinition(packageDef) as any
  return new proto.agentcore.AgentService(`127.0.0.1:${port}`, grpc.credentials.createInsecure())
}

function unary<T>(fn: (cb: (err: any, res: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))))
}

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

describe('Phase 6.3 — gRPC', () => {
  it('CreateSession -> SendMessage (unary) qua gRPC thật (có auth metadata)', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const client = makeClient(config.port!)
      const token = await signup(root, 'alice')

      const created = await unary<any>((cb) => client.createSession({ system_prompt: 'bạn là trợ lý' }, authMeta(token), cb))
      expect(created.id).toBeTruthy()
      expect(created.driver).toBe('default')
      expect(created.max_steps).toBe(25)

      // SendMessage (unary) trả kết quả CUỐI CÙNG của cả turn (sau khi tool đã
      // chạy xong), không phải phản hồi đầu tiên của model — cùng ngữ nghĩa
      // với REST /messages.
      const result = await unary<any>((cb) => client.sendMessage({ session_id: created.id, message: 'hỏi gì đó' }, authMeta(token), cb))
      expect(result.content).toBe('xong rồi')
      expect(result.steps).toBe(1)

      client.close()
    })
  })

  it('thiếu metadata hoặc token sai -> UNAUTHENTICATED, không chạm tới ctx.sessions', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const client = makeClient(config.port!)

      await expect(
        unary((cb) => client.createSession({}, cb)),
      ).rejects.toMatchObject({ code: grpc.status.UNAUTHENTICATED })

      await expect(
        unary((cb) => client.createSession({}, authMeta('sai-token'), cb)),
      ).rejects.toMatchObject({ code: grpc.status.UNAUTHENTICATED })

      client.close()
    })
  })

  it('SendMessage cho session không tồn tại -> NOT_FOUND', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const client = makeClient(config.port!)
      const token = await signup(root, 'alice')

      await expect(
        unary((cb) => client.sendMessage({ session_id: 'khong-ton-tai', message: 'x' }, authMeta(token), cb)),
      ).rejects.toMatchObject({ code: grpc.status.NOT_FOUND })

      client.close()
    })
  })

  it('gap thật đã sửa: user KHÁC gọi SendMessage vào session không phải của mình -> PERMISSION_DENIED', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const client = makeClient(config.port!)
      const aliceToken = await signup(root, 'alice')
      const bobToken = await signup(root, 'bob')

      const created = await unary<any>((cb) => client.createSession({}, authMeta(aliceToken), cb))

      await expect(
        unary((cb) => client.sendMessage({ session_id: created.id, message: 'x' }, authMeta(bobToken), cb)),
      ).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED })

      client.close()
    })
  })

  it('StreamTurn: server-streaming trả đủ step đúng thứ tự (có auth metadata)', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const client = makeClient(config.port!)
      const token = await signup(root, 'alice')

      const created = await unary<any>((cb) => client.createSession({}, authMeta(token), cb))

      const events: any[] = []
      await new Promise<void>((resolve, reject) => {
        const stream = client.streamTurn({ session_id: created.id, message: 'chào' }, authMeta(token))
        stream.on('data', (chunk: any) => events.push(chunk))
        stream.on('end', resolve)
        stream.on('error', reject)
      })

      expect(events.map((e) => e.type)).toEqual(['model_message', 'tool_result', 'model_message', 'final'])
      expect(events[0].tool_call_name).toBe('echo')
      expect(JSON.parse(events[0].tool_ui_json)).toEqual({ icon: '🔁', label: 'Echo' })
      expect(JSON.parse(events[1].tool_result_json)).toEqual({ text: 'hi' })
      expect(JSON.parse(events[1].tool_ui_json)).toEqual({ icon: '🔁', label: 'Echo' })
      expect(events[2].tool_ui_json).toBe('') // model_message không toolCall -> không tra ui
      expect(events[3].content).toBe('xong rồi')
      for (const e of events) expect(e.session_id).toBe(created.id)

      client.close()
    })
  })

  it(
    'mount -> unmount -> server đóng sạch',
    async () => {
      await withFreshSchemaUrl(async (databaseUrl) => {
        const { root, fiber, config } = await bootApp(databaseUrl)
        const client = makeClient(config.port!)
        const token = await signup(root, 'alice')

        await unary((cb) => client.createSession({}, authMeta(token), cb))

        await fiber.dispose()
        client.close()

        const deadClient = makeClient(config.port!)
        await expect(
          unary((cb) => {
            deadClient.createSession({}, authMeta(token), { deadline: Date.now() + 2000 }, cb)
          }),
        ).rejects.toBeTruthy()
        deadClient.close()
      })
    },
    10000,
  )
})
