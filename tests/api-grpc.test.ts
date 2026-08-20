// Phase 6.3 deliverable: test dùng gRPC client thật (@grpc/grpc-js) gọi
// CreateSession/SendMessage/StreamTurn vào server thật — không mock transport.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as authApiKey from '../bundles/providers/auth-apikey/index.ts'
import * as apiGrpc from '../bundles/adapters/api-grpc/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'

const TEST_KEY = 'test-key-abc'

function authMeta(token = TEST_KEY) {
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
    // Phase 8.5: `ui` khai ở đây để test StreamTurn dưới xác nhận
    // `tool_ui_json` đi xuyên suốt loop-default -> agent/step -> proto.
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
  const config: apiGrpc.ApiGrpc.Config = { port: 0 }
  const fiber = root.plugin(apiGrpc, config)
  await settle()
  await fiber.await()
  return { root, fiber, config }
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

let cleanup: (() => Promise<unknown>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

describe('Phase 6.3 — gRPC', () => {
  it('CreateSession -> SendMessage (unary) qua gRPC thật (có auth metadata)', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()
    const client = makeClient(config.port!)

    const created = await unary<any>((cb) => client.createSession({ system_prompt: 'bạn là trợ lý' }, authMeta(), cb))
    expect(created.id).toBeTruthy()
    expect(created.driver).toBe('default')
    expect(created.max_steps).toBe(8)

    // SendMessage (unary) trả kết quả CUỐI CÙNG của cả turn (sau khi tool đã
    // chạy xong), không phải phản hồi đầu tiên của model — cùng ngữ nghĩa
    // với REST /messages.
    const result = await unary<any>((cb) => client.sendMessage({ session_id: created.id, message: 'hỏi gì đó' }, authMeta(), cb))
    expect(result.content).toBe('xong rồi')
    expect(result.steps).toBe(1)

    client.close()
  })

  it('thiếu metadata hoặc key sai -> UNAUTHENTICATED, không chạm tới ctx.sessions', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()
    const client = makeClient(config.port!)

    await expect(
      unary((cb) => client.createSession({}, cb)),
    ).rejects.toMatchObject({ code: grpc.status.UNAUTHENTICATED })

    await expect(
      unary((cb) => client.createSession({}, authMeta('sai-key'), cb)),
    ).rejects.toMatchObject({ code: grpc.status.UNAUTHENTICATED })

    client.close()
  })

  it('SendMessage cho session không tồn tại -> NOT_FOUND', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()
    const client = makeClient(config.port!)

    await expect(
      unary((cb) => client.sendMessage({ session_id: 'khong-ton-tai', message: 'x' }, authMeta(), cb)),
    ).rejects.toMatchObject({ code: grpc.status.NOT_FOUND })

    client.close()
  })

  it('StreamTurn: server-streaming trả đủ step đúng thứ tự (có auth metadata)', async () => {
    const { fiber, config } = await bootApp()
    cleanup = () => fiber.dispose()
    const client = makeClient(config.port!)

    const created = await unary<any>((cb) => client.createSession({}, authMeta(), cb))

    const events: any[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = client.streamTurn({ session_id: created.id, message: 'chào' }, authMeta())
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

  it('mount -> unmount -> server đóng sạch', async () => {
    const { fiber, config } = await bootApp()
    const client = makeClient(config.port!)

    await unary((cb) => client.createSession({}, authMeta(), cb))

    await fiber.dispose()
    client.close()

    const deadClient = makeClient(config.port!)
    await expect(
      unary((cb) => {
        deadClient.createSession({}, authMeta(), { deadline: Date.now() + 2000 }, cb)
      }),
    ).rejects.toBeTruthy()
    deadClient.close()
  }, 10000)
})
