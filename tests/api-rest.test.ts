// Phase 6.1 deliverable: server REST thật lắng nghe port, test gọi bằng
// `fetch` thật (không mock) — tạo session, gửi message, nhận kết quả, đọc
// lại event; mount → unmount → cổng đã đóng sạch.
//
// Module auth (nhiều người dùng thật): auth-users cần Postgres thật (không
// mock) — mỗi test tự tạo 1 schema riêng (cùng pattern cô lập đã dùng ở
// tests/auth-users.test.ts). Lấy token qua signup thật, không còn API key
// tĩnh — đúng luồng thật client sẽ đi qua.
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
import * as projectRegistry from '../bundles/providers/project-registry/index.ts'
import * as authUsers from '../bundles/providers/auth-users/index.ts'
import * as pluginInventory from '../bundles/providers/plugin-inventory/index.ts'
import * as pluginConfigPostgres from '../bundles/providers/plugin-config-postgres/index.ts'
import * as customSkillStorePostgres from '../bundles/providers/custom-skill-store-postgres/index.ts'
import * as apiRest from '../bundles/adapters/api-rest/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { WorkspaceService, type WorkspaceSnapshot } from '../seams/workspace.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:test@127.0.0.1:5433/agent_core_test'

class FakeWorkspace extends WorkspaceService {
  private files = new Map<string, Map<string, Buffer>>()
  root(sessionId: string) { return `/fake/${sessionId}` }
  private session(sessionId: string) {
    let files = this.files.get(sessionId)
    if (!files) { files = new Map(); this.files.set(sessionId, files) }
    return files
  }
  listDatasets(sessionId: string) {
    return [...this.session(sessionId).keys()]
      .filter((name) => /\.(csv|tsv|xlsx|xls|parquet)$/i.test(name))
      .map((filename) => ({ id: filename.replace(/\.[^.]+$/, ''), filename, path: filename }))
  }
  listArtifacts(sessionId: string) {
    return [...this.session(sessionId).keys()].filter((name) => name.startsWith('generated/'))
  }
  async inspect(sessionId: string): Promise<WorkspaceSnapshot> {
    return { datasets: [], resources: { datasets: this.listDatasets(sessionId), artifacts: this.listArtifacts(sessionId) } }
  }
  async writeFile(sessionId: string, filename: string, content: Buffer) {
    this.session(sessionId).set(filename, Buffer.from(content))
    return { path: filename, size: content.byteLength }
  }
  async readFile(sessionId: string, filePath: string) {
    const value = this.session(sessionId).get(filePath)
    if (!value) throw new Error(`file ${filePath} not found`)
    return Buffer.from(value)
  }
  async deleteFile(sessionId: string, filePath: string) {
    return this.session(sessionId).delete(filePath)
  }
  async listFiles(sessionId: string) {
    return [...this.session(sessionId)].map(([filePath, content]) => ({ path: filePath, size: content.byteLength, mtime: '2026-01-01T00:00:00.000Z' }))
  }
  async listSourceFiles(sessionId: string) {
    return (await this.listFiles(sessionId)).filter((file) => !file.path.startsWith('generated/') && !file.path.startsWith('outputs/') && !file.path.startsWith('.sessions/'))
  }
  async listSessionOutputs(sessionId: string, runtimeSessionId: string) {
    const prefix = `.sessions/${runtimeSessionId}/generated/`
    return (await this.listFiles(sessionId)).filter((file) => file.path.startsWith(prefix)).map((file) => ({ ...file, path: file.path.slice(prefix.length) }))
  }
  async listProjectOutputs(sessionId: string) {
    return (await this.listFiles(sessionId)).filter((file) => file.path.startsWith('outputs/')).map((file) => ({ ...file, path: file.path.slice('outputs/'.length) }))
  }
  async promoteSessionOutput(sessionId: string, runtimeSessionId: string, sourcePath: string, outputName?: string) {
    const source = sourcePath.replace(/^generated\//, '')
    const content = await this.readFile(sessionId, `.sessions/${runtimeSessionId}/generated/${source}`)
    const target = outputName ?? source
    this.session(sessionId).set(`outputs/${target}`, content)
    return { path: target, size: content.byteLength, mtime: '2026-01-01T00:00:00.000Z', sourcePath: source, createdBySession: runtimeSessionId }
  }
}

const fakeWorkspace = (ctx: Context) => { ctx.plugin(FakeWorkspace) }

class FakeLlm extends LlmService {
  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    const userMsg = messages.find((m) => m.role === 'user')?.content ?? ''
    return { content: `trả lời cho: ${userMsg}` }
  }
}
const fakeLlm = (ctx: Context) => {
  ctx.plugin(FakeLlm)
}
// Phase 6.3 (dồn từ tests/api-ws.test.ts đã xoá): LLM có kịch bản gọi tool
// rồi mới trả lời cuối — dùng riêng cho describe('WS downlink') bên dưới,
// KHÔNG dùng chung `fakeLlm` (chỉ echo phẳng) để không ảnh hưởng các test
// REST hiện có phía trên.
class ScriptedToolLlm extends LlmService {
  async complete(messages: LlmMessage[], _options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    const hasToolResult = messages.some((m) => m.role === 'tool')
    if (!hasToolResult) return { content: 'tra dữ liệu', toolCall: { name: 'echo', args: { text: 'hi' } } }
    return { content: 'xong rồi' }
  }
}
const scriptedToolLlm = (ctx: Context) => { ctx.plugin(ScriptedToolLlm) }
const echoTool = Object.assign(
  (ctx: Context) => {
    ctx.tools.add({ name: 'echo', description: 'echo', ui: { icon: '🔁', label: 'Echo' }, async handler(args) { return args } })
  },
  { inject: ['tools'] },
)

const fakeSkills = Object.assign(
  (ctx: Context) => {
    ctx.skills.register({
      name: 'analyze',
      description: 'Analyze a concrete data question',
      instructions: 'Analyze carefully.',
      triggers: [],
      userInvocable: true,
    })
    ctx.skills.register({
      name: 'internal-helper',
      description: 'Internal only',
      instructions: 'Internal.',
      triggers: [],
      userInvocable: false,
    })
  },
  { inject: ['skills'] },
)

async function settle() {
  // Auth-users giờ làm I/O mạng thật (Postgres qua pg.Pool), khác các provider
  // đồng bộ trước đây — 10ms (đủ cho SQLite/RBAC in-memory) không đủ cho
  // fiber chain hội tụ, khiến fiber.await() resolve SỚM lúc còn PENDING
  // (đúng gotcha đã ghi trong build plan) -> test fetch vào cổng chưa kịp
  // listen. Xác nhận thực nghiệm: tăng lên 100ms sửa dứt điểm.
  await new Promise((r) => setTimeout(r, 100))
}

let cleanup: (() => Promise<unknown>) | undefined

// Gap thật phát hiện lúc chạy test (không phải giả thuyết): CREATE SCHEMA +
// truyền `?options=-c search_path=...` qua connection string KHÔNG áp dụng
// tin cậy cho `pg.Pool` (Pool luân phiên nhiều connection vật lý, search_path
// đặt qua option chuỗi kết nối không chắc theo đúng connection nào phục vụ
// mỗi query — xác nhận thật qua log Postgres: "no schema has been selected
// to create in"). Sửa bằng CREATE DATABASE riêng mỗi test — cô lập tuyệt
// đối, không phụ thuộc hành vi search_path của pool.
//
// CHỦ ĐÍCH KHÔNG DROP DATABASE sau mỗi test: pg_terminate_backend() chỉ gửi
// tín hiệu, KHÔNG đóng connection đồng bộ ngay — DROP DATABASE chạy ngay sau
// đó vẫn có thể gặp "being accessed by other users" (race thật đã gặp khi
// viết test này), và exception đó làm hỏng luôn admin pool giữa chừng,
// kéo theo các test SAU cũng fail dây chuyền. Test dùng 1 Postgres THROWAWAY
// riêng cho lần chạy test (xem README/plan) — vài database rác không dọn
// hết không phải vấn đề thật ở môi trường đó.
// 1 pool admin DÙNG CHUNG cho toàn file (không tạo/đóng mới mỗi test) — hạn
// chế số connection Postgres mở/đóng liên tục, giảm khả năng cạn kiệt
// ephemeral port cục bộ khi chạy nhiều test liên tiếp trong môi trường sandbox.
const adminUrl = new URL(DATABASE_URL)
adminUrl.pathname = '/postgres'
const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 })

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

async function bootApp(databaseUrl: string, port = 0, extraConfig: Partial<apiRest.ApiRest.Config> = {}) {
  const root = new Context()
  root.plugin(toolRegistry)
  root.plugin(skillRegistry)
  root.plugin(promptRegistry)
  root.plugin(promptDefaultAgent)
  root.plugin(contextCompactorLlm)
  root.plugin(fakeSkills)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(fakeLlm)
  root.plugin(loopRegistry)
  root.plugin(loopDefault)
  root.plugin(agentRunner)
  root.plugin(sessionRegistry)
  root.plugin(projectRegistry)
  root.plugin(permissionRbac, {
    rules: { admin: ['admin:users:manage', 'admin:plugins:view', 'admin:plugins:configure'] },
  })
  root.plugin(authUsers, { connectionString: databaseUrl })
  root.plugin(pluginInventory, [{ name: 'tool-registry', category: 'provider', fiber: { state: 2 } }])
  root.plugin(pluginConfigPostgres, { connectionString: databaseUrl })
  root.plugin(customSkillStorePostgres, { connectionString: databaseUrl })
  root.plugin(fakeWorkspace)
  const config: apiRest.ApiRest.Config = { port, ...extraConfig }
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

// Phase 6.3: y hệt bootApp() nhưng LLM có kịch bản gọi tool (scriptedToolLlm
// + echoTool) thay vì fakeLlm — chỉ describe('WS downlink') bên dưới dùng.
async function bootAppForStreaming(databaseUrl: string) {
  const root = new Context()
  root.plugin(toolRegistry)
  root.plugin(skillRegistry)
  root.plugin(promptRegistry)
  root.plugin(promptDefaultAgent)
  root.plugin(contextCompactorLlm)
  root.plugin(fakeSkills)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(echoTool)
  root.plugin(scriptedToolLlm)
  root.plugin(loopRegistry)
  root.plugin(loopDefault)
  root.plugin(agentRunner)
  root.plugin(sessionRegistry)
  // api-rest hard-`inject`s 'projects' (không phải soft ctx.get()) — thiếu
  // mount này khiến fiber api-rest treo PENDING mãi mãi, server.listen()
  // không bao giờ chạy, config.port giữ nguyên 0 -> mọi fetch() sau đó throw
  // lỗi connect cấp thấp khó hiểu (EADDRNOTAVAIL) thay vì lỗi rõ ràng. Gap
  // thật phát hiện lúc merge feat/rlm-dev-integration (bootApp() ở trên đã
  // có projectRegistry từ trước, bootAppForStreaming() thì chưa).
  root.plugin(projectRegistry)
  root.plugin(permissionRbac, {
    rules: { admin: ['admin:users:manage', 'admin:plugins:view', 'admin:plugins:configure'] },
  })
  root.plugin(authUsers, { connectionString: databaseUrl })
  root.plugin(pluginInventory, [{ name: 'tool-registry', category: 'provider', fiber: { state: 2 } }])
  root.plugin(pluginConfigPostgres, { connectionString: databaseUrl })
  root.plugin(customSkillStorePostgres, { connectionString: databaseUrl })
  root.plugin(fakeWorkspace)
  const config: apiRest.ApiRest.Config = { port: 0 }
  const fiber = root.plugin(apiRest, config)
  await settle()
  await fiber.await()
  return { root, fiber, config }
}

function connectWs(port: number, path: string, authorization?: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: authorization ? { authorization } : {} })
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

async function signupToken(base: string, username: string, password = 'correcthorse123') {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await res.json()
  return { status: res.status, token: body.token as string, user: body.user }
}

// afterEach fallback — bình thường `withFreshSchemaUrl` đã tự gọi cleanup()
// đúng thứ tự (trước khi drop database) và set về undefined; hook này chỉ
// bắt trường hợp 1 test throw TRƯỚC KHI kịp gọi withFreshSchemaUrl.
afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

describe('Phase 6.1 — REST API', () => {
  it('liệt kê đúng skill mà UI được phép chọn', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')

      const response = await fetch(`${base}/skills`, { headers: { authorization: `Bearer ${token}` } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        skills: [{ name: 'analyze', description: 'Analyze a concrete data question' }],
      })
    })
  })

  it('signup (đầu tiên -> admin) -> tạo session, gửi message, đọc lại event — qua HTTP thật', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`

      const health = await fetch(`${base}/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: 'ok' })

      const ready = await fetch(`${base}/ready`)
      expect(ready.status).toBe(200)
      expect(await ready.json()).toEqual({ ready: true })

      const { status, token, user } = await signupToken(base, 'alice')
      expect(status).toBe(201)
      expect(user.role).toBe('admin') // user đầu tiên trong hệ thống -> bootstrap admin
      const AUTH_HEADER = { authorization: `Bearer ${token}` }

      const createRes = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ id: 'rest-1', systemPrompt: 'bạn là trợ lý' }),
      })
      expect(createRes.status).toBe(201)
      const created = await createRes.json()
      expect(created).toEqual({ id: 'rest-1', driver: 'default', maxSteps: 25 })

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
      expect(events.map((e: any) => e.type)).toEqual(['user_message', 'prompt_assembled', 'model_message'])
    })
  })

  it('upload binary -> hiện trong workspace -> tải lại đúng nội dung', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')
      const AUTH_HEADER = { authorization: `Bearer ${token}` }

      await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ id: 'files-1' }),
      })

      const uploaded = await fetch(`${base}/sessions/files-1/files`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent('sales data.csv'),
          ...AUTH_HEADER,
        },
        body: 'region,revenue\nAPAC,42\n',
      })
      expect(uploaded.status).toBe(201)
      expect(await uploaded.json()).toEqual({ path: 'sales data.csv', size: 23 })

      const listed = await fetch(`${base}/sessions/files-1/files`, { headers: AUTH_HEADER })
      expect(listed.status).toBe(200)
      expect(await listed.json()).toMatchObject({
        files: [{ path: 'sales data.csv', size: 23 }],
        datasets: [{ filename: 'sales data.csv' }],
      })

      const downloaded = await fetch(`${base}/sessions/files-1/files/${encodeURIComponent('sales data.csv')}`, { headers: AUTH_HEADER })
      expect(downloaded.status).toBe(200)
      expect(await downloaded.text()).toBe('region,revenue\nAPAC,42\n')
    })
  })

  // Finding A1/A2 (docs/agent-core-rate-limit-and-security-audit.md,
  // docs/agent-core-rlm-harness-merge-plan.md mục 3.1): khối
  // /sessions/:id/files merge từ nhánh RLM thiếu canAccessSession() — user
  // khác (không phải chủ session) từng đọc/ghi được file của session đó chỉ
  // cần biết đúng id. Khoá lại hành vi 403 đã thêm lúc merge.
  it('403 khi user khác truy cập workspace file của session không phải mình', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token: aliceToken } = await signupToken(base, 'alice')
      const { token: bobToken } = await signupToken(base, 'bob')

      await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${aliceToken}` },
        body: JSON.stringify({ id: 'alice-files' }),
      })

      const listAsBob = await fetch(`${base}/sessions/alice-files/files`, {
        headers: { authorization: `Bearer ${bobToken}` },
      })
      expect(listAsBob.status).toBe(403)

      const uploadAsBob = await fetch(`${base}/sessions/alice-files/files`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent('leak.csv'),
          authorization: `Bearer ${bobToken}`,
        },
        body: 'a,b\n1,2\n',
      })
      expect(uploadAsBob.status).toBe(403)
    })
  })

  it('project cô lập nguồn, gom nhiều RLM chat và chặn user khác qua HTTP thật', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      await signupToken(base, 'admin')
      const bob = await signupToken(base, 'bob')
      const charlie = await signupToken(base, 'charlie')
      const auth = { authorization: `Bearer ${bob.token}` }

      const createProject = async (name: string) => {
        const response = await fetch(`${base}/projects`, {
          method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name }),
        })
        expect(response.status).toBe(201)
        return (await response.json()).project as { id: string }
      }
      const a = await createProject('A')
      const b = await createProject('B')
      const upload = await fetch(`${base}/projects/${a.id}/files`, {
        method: 'POST', headers: { ...auth, 'content-type': 'application/octet-stream', 'x-file-name': 'sales.csv' },
        body: 'amount\n42\n',
      })
      expect(upload.status).toBe(201)
      const listA = await (await fetch(`${base}/projects/${a.id}/files`, { headers: auth })).json()
      const listB = await (await fetch(`${base}/projects/${b.id}/files`, { headers: auth })).json()
      expect(listA.files.map((file: any) => file.path)).toContain('sales.csv')
      expect(listB.files.map((file: any) => file.path)).not.toContain('sales.csv')
      const sourcesA = await (await fetch(`${base}/projects/${a.id}/sources`, { headers: auth })).json()
      expect(sourcesA.sources.map((file: any) => file.path)).toEqual(['sales.csv'])
      const refuseSourceDelete = await fetch(`${base}/projects/${a.id}/files/${encodeURIComponent('sales.csv')}`, { method: 'DELETE', headers: auth })
      expect(refuseSourceDelete.status).toBe(403)
      expect((await fetch(`${base}/projects/${a.id}/files/${encodeURIComponent('sales.csv')}`, { headers: auth })).status).toBe(200)

      const first = await (await fetch(`${base}/projects/${a.id}/sessions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).json()
      const second = await (await fetch(`${base}/projects/${a.id}/sessions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).json()
      expect(first).toMatchObject({ driver: 'rlm', projectId: a.id })
      expect(second).toMatchObject({ driver: 'rlm', projectId: a.id })

      await root.workspace.writeFile(`project:${a.id}`, `.sessions/${first.id}/generated/draft.json`, Buffer.from('{"score":0.9}'))
      const outputsBefore = await (await fetch(`${base}/projects/${a.id}/outputs`, { headers: auth })).json()
      expect(outputsBefore.projectOutputs).toEqual([])
      expect(outputsBefore.sessionOutputs.find((group: any) => group.sessionId === first.id).files).toEqual([
        expect.objectContaining({ path: 'draft.json' }),
      ])
      expect(outputsBefore.sessionOutputs.find((group: any) => group.sessionId === second.id).files).toEqual([])
      const draftDownload = await fetch(`${base}/projects/${a.id}/outputs/session/${first.id}/${encodeURIComponent('draft.json')}`, { headers: auth })
      expect(draftDownload.status).toBe(200)
      expect(await draftDownload.text()).toBe('{"score":0.9}')

      const promoted = await fetch(`${base}/projects/${a.id}/outputs`, {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: first.id, path: 'draft.json' }),
      })
      expect(promoted.status).toBe(201)
      const outputsAfter = await (await fetch(`${base}/projects/${a.id}/outputs`, { headers: auth })).json()
      expect(outputsAfter.projectOutputs).toEqual([expect.objectContaining({ path: 'draft.json' })])
      const publishedDownload = await fetch(`${base}/projects/${a.id}/outputs/project/${encodeURIComponent('draft.json')}`, { headers: auth })
      expect(publishedDownload.status).toBe(200)
      expect(await publishedDownload.text()).toBe('{"score":0.9}')

      const deleteDraft = await fetch(`${base}/projects/${a.id}/outputs/session/${first.id}/${encodeURIComponent('draft.json')}`, { method: 'DELETE', headers: auth })
      expect(deleteDraft.status).toBe(204)
      const deletePublished = await fetch(`${base}/projects/${a.id}/outputs/project/${encodeURIComponent('draft.json')}`, { method: 'DELETE', headers: auth })
      expect(deletePublished.status).toBe(204)
      const outputsAfterDelete = await (await fetch(`${base}/projects/${a.id}/outputs`, { headers: auth })).json()
      expect(outputsAfterDelete.projectOutputs).toEqual([])
      expect(outputsAfterDelete.sessionOutputs.find((group: any) => group.sessionId === first.id).files).toEqual([])
      expect((await fetch(`${base}/projects/${a.id}/outputs/project/${encodeURIComponent('draft.json')}`, { headers: auth })).status).toBe(404)

      expect((await fetch(`${base}/projects/${a.id}`, { headers: { authorization: `Bearer ${charlie.token}` } })).status).toBe(403)
      expect((await fetch(`${base}/projects/${a.id}/files`, { headers: { authorization: `Bearer ${charlie.token}` } })).status).toBe(403)
      expect((await fetch(`${base}/projects/${a.id}/outputs`, { headers: { authorization: `Bearer ${charlie.token}` } })).status).toBe(403)
    })
  })

  it('404 cho session không tồn tại, 400 cho body thiếu message (có auth)', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')
      const AUTH_HEADER = { authorization: `Bearer ${token}` }

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
  })

  it('401 khi thiếu token hoặc token sai — /health /ready /auth/signup /auth/login vẫn không cần token', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
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

      const wrongToken = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer sai-token' },
        body: JSON.stringify({}),
      })
      expect(wrongToken.status).toBe(401)
    })
  })

  it('CORS: preflight OPTIONS trả 204 kèm header, response thật kèm Access-Control-Allow-Origin', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`

      const preflight = await fetch(`${base}/sessions`, {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:8790' },
      })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
      expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization')
      expect(preflight.headers.get('access-control-allow-headers')).toContain('x-file-name')
      // Bug thật đã gặp: PUT /plugin-settings/:key (Phase 34) hoạt động đúng
      // qua curl (không enforce CORS) nhưng bị MỌI trình duyệt thật chặn ở
      // bước preflight vì method PUT không có trong danh sách -- server
      // KHÔNG log gì (request thật chưa bao giờ tới nơi), dễ tưởng nhầm là
      // lỗi backend. Assert danh sách đủ mọi method route thật đang dùng để
      // regression này không lặp lại khi có route mới.
      const allowedMethods = (preflight.headers.get('access-control-allow-methods') ?? '').split(',').map((m) => m.trim())
      expect(allowedMethods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']))

      const health = await fetch(`${base}/health`)
      expect(health.headers.get('access-control-allow-origin')).toBe('*')
    })
  })

  it('413 khi body vượt giới hạn cấu hình', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      // 80 byte — đủ cho body signup thật ({"username":"alice","password":
      // "correcthorse123"} ~49 byte) qua lọt, nhưng vẫn nhỏ hơn body
      // /sessions cố tình dài phía dưới (16 byte cũ sẽ chặn LUÔN CẢ signup,
      // làm token rỗng -> lỗi sai thành 401 thay vì 413 đang muốn test).
      const { fiber, config } = await bootApp(databaseUrl, 0, { maxBodyBytes: 80 })
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')

      const res = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ systemPrompt: 'chuỗi này chắc chắn dài hơn 80 byte giới hạn đã cấu hình ở trên, thêm chữ cho chắc ăn' }),
      })
      expect(res.status).toBe(413)
    })
  })

  it('gap thật đã sửa: user KHÁC không đọc/ghi được session không phải của mình (403), admin thì được', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`

      const alice = await signupToken(base, 'alice') // admin (đầu tiên)
      const bob = await signupToken(base, 'bob') // user thường
      expect(bob.user.role).toBe('user')

      const created = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({}),
      })
      const { id: sessionId } = await created.json()

      const carol = await signupToken(base, 'carol')
      const forbidden = await fetch(`${base}/sessions/${sessionId}/events`, {
        headers: { authorization: `Bearer ${carol.token}` },
      })
      expect(forbidden.status).toBe(403)

      const asAdmin = await fetch(`${base}/sessions/${sessionId}/events`, {
        headers: { authorization: `Bearer ${alice.token}` },
      })
      expect(asAdmin.status).toBe(200)
    })
  })

  it('GET /sessions chỉ liệt kê session CỦA CHÍNH caller, admin thấy hết', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`

      const alice = await signupToken(base, 'alice')
      const bob = await signupToken(base, 'bob')

      await fetch(`${base}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${bob.token}` } })

      const bobList = await (await fetch(`${base}/sessions`, { headers: { authorization: `Bearer ${bob.token}` } })).json()
      expect(bobList.sessions.length).toBe(1)

      const aliceList = await (await fetch(`${base}/sessions`, { headers: { authorization: `Bearer ${alice.token}` } })).json()
      expect(aliceList.sessions.length).toBe(1) // admin thấy session của bob dù không tự tạo
    })
  })

  it('/users: chỉ admin gọi được (403 cho user thường), PATCH đổi role/active thật', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`

      const alice = await signupToken(base, 'alice') // admin
      const bob = await signupToken(base, 'bob') // user

      const forbidden = await fetch(`${base}/users`, { headers: { authorization: `Bearer ${bob.token}` } })
      expect(forbidden.status).toBe(403)

      const asAdmin = await fetch(`${base}/users`, { headers: { authorization: `Bearer ${alice.token}` } })
      expect(asAdmin.status).toBe(200)
      const { users } = await asAdmin.json()
      expect(users.map((u: any) => u.username).sort()).toEqual(['alice', 'bob'])

      const patched = await fetch(`${base}/users/${bob.user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ role: 'admin' }),
      })
      expect(patched.status).toBe(200)
      expect((await patched.json()).user.role).toBe('admin')
    })
  })

  it('/plugins: chỉ admin gọi được (403 cho user thường), trả đúng snapshot ctx.pluginInventory', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`

      const alice = await signupToken(base, 'alice') // admin
      const bob = await signupToken(base, 'bob') // user

      const forbidden = await fetch(`${base}/plugins`, { headers: { authorization: `Bearer ${bob.token}` } })
      expect(forbidden.status).toBe(403)

      const asAdmin = await fetch(`${base}/plugins`, { headers: { authorization: `Bearer ${alice.token}` } })
      expect(asAdmin.status).toBe(200)
      expect(await asAdmin.json()).toEqual({
        plugins: [{ name: 'tool-registry', category: 'provider', state: 'active' }],
      })
    })
  })

  it('/plugin-settings: chỉ admin gọi được, PUT/GET/DELETE hoạt động đúng, không lộ giá trị thật qua GET', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`

      const alice = await signupToken(base, 'alice') // admin
      const bob = await signupToken(base, 'bob') // user

      const forbiddenGet = await fetch(`${base}/plugin-settings`, { headers: { authorization: `Bearer ${bob.token}` } })
      expect(forbiddenGet.status).toBe(403)
      const forbiddenPut = await fetch(`${base}/plugin-settings/serperApiKey`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bob.token}` },
        body: JSON.stringify({ value: 'x' }),
      })
      expect(forbiddenPut.status).toBe(403)

      const emptyList = await fetch(`${base}/plugin-settings`, { headers: { authorization: `Bearer ${alice.token}` } })
      expect(emptyList.status).toBe(200)
      expect(await emptyList.json()).toEqual({ configured: [] })

      const putRes = await fetch(`${base}/plugin-settings/serperApiKey`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ value: 'real-secret-key' }),
      })
      expect(putRes.status).toBe(200)
      expect(await putRes.json()).toEqual({ key: 'serperApiKey', configured: true })

      const afterPut = await fetch(`${base}/plugin-settings`, { headers: { authorization: `Bearer ${alice.token}` } })
      const afterPutBody = await afterPut.json()
      expect(afterPutBody).toEqual({ configured: ['serperApiKey'] })
      // Giá trị thật (secret) không bao giờ được xuất hiện trong response GET.
      expect(JSON.stringify(afterPutBody)).not.toContain('real-secret-key')

      const emptyValue = await fetch(`${base}/plugin-settings/serperApiKey`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ value: '' }),
      })
      expect(emptyValue.status).toBe(400)

      const deleteRes = await fetch(`${base}/plugin-settings/serperApiKey`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${alice.token}` },
      })
      expect(deleteRes.status).toBe(204)

      const afterDelete = await fetch(`${base}/plugin-settings`, { headers: { authorization: `Bearer ${alice.token}` } })
      expect(await afterDelete.json()).toEqual({ configured: [] })
    })
  })

  // Follow-up (2026-08) — third-party extensibility: tool TỰ khai
  // `configSchema` (seams/tools.ts, ToolDefinition.configSchema) ngay tại
  // `ctx.tools.add()` của chính nó, KHÔNG cần đăng ký gì thêm ở tầng
  // api-rest hay pluginInventory -- verify đúng bằng cách add() 1 fake tool
  // sau `bootApp()` (mô phỏng đúng cách 1 plugin bên thứ 3 nạp qua
  // EXTRA_PLUGINS sẽ làm) và xác nhận nó xuất hiện qua endpoint không cần
  // sửa gì ở api-rest.
  it('/tool-config-schema: chỉ admin gọi được, trả đúng configSchema tool tự khai (kể cả tool add() SAU khi mount)', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { root, fiber, config } = await bootApp(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`

      root.tools.add({
        name: 'fake_third_party_tool',
        description: 'mô phỏng tool bên thứ 3 nạp qua EXTRA_PLUGINS',
        async handler(args) { return args },
        configSchema: [{ key: 'fakeApiKey', label: 'Fake API key', description: 'mô tả test' }],
      })
      // Tool KHÔNG khai configSchema -- không được xuất hiện trong response.
      root.tools.add({ name: 'no_config_tool', description: 'không cần cấu hình gì', async handler(args) { return args } })

      const alice = await signupToken(base, 'alice') // admin
      const bob = await signupToken(base, 'bob') // user

      const forbidden = await fetch(`${base}/tool-config-schema`, { headers: { authorization: `Bearer ${bob.token}` } })
      expect(forbidden.status).toBe(403)

      const asAdmin = await fetch(`${base}/tool-config-schema`, { headers: { authorization: `Bearer ${alice.token}` } })
      expect(asAdmin.status).toBe(200)
      expect(await asAdmin.json()).toEqual({
        entries: [{ toolName: 'fake_third_party_tool', key: 'fakeApiKey', label: 'Fake API key', description: 'mô tả test' }],
      })
    })
  })

  // Phase 6.3: gộp 2 test mount->unmount cũ (api-rest + api-ws) thành 1 —
  // giờ là CÙNG 1 server nên phải đóng sạch cho CẢ 2 protocol cùng lúc.
  it('mount -> unmount -> cổng đóng sạch cho CẢ REST lẫn WS (không còn ai lắng nghe)', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootApp(databaseUrl)
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')
      const created = await fetch(`${base}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
      const { id: sessionId } = await created.json()

      expect((await fetch(`${base}/health`)).status).toBe(200)
      const ws = await connectWs(config.port!, `/sessions/${sessionId}/events/stream`, `Bearer ${token}`)
      ws.close()
      await new Promise((r) => setTimeout(r, 10))

      await fiber.dispose()

      await expect(fetch(`${base}/health`)).rejects.toThrow()
      await expect(connectWs(config.port!, `/sessions/${sessionId}/events/stream`, `Bearer ${token}`)).rejects.toThrow()
    })
  })
})

describe('Phase 6.3 — WS downlink (chung server với REST, không còn create_session/send_message qua WS)', () => {
  it('POST /sessions -> WS subscribe -> POST /sessions/:id/messages -> stream step...done khớp response REST', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootAppForStreaming(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')

      const createRes = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      const { id: sessionId } = await createRes.json()

      const ws = await connectWs(config.port!, `/sessions/${sessionId}/events/stream`, `Bearer ${token}`)
      const queue = messageQueue(ws)
      try {
        const msgRes = await fetch(`${base}/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: 'chào' }),
        })
        expect(msgRes.status).toBe(200)
        const restResult = await msgRes.json()

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
        // 'done' qua WS phải khớp CHÍNH XÁC response JSON của POST /messages
        // — 2 con đường đọc cùng 1 kết quả (agent/turn-done vs return value),
        // không phải 2 nguồn có thể lệch nhau.
        expect(messages[4].result).toEqual(restResult)
        for (const m of messages) expect(m.sessionId).toBe(sessionId)
      } finally {
        ws.close()
      }
    })
  })

  it('WS upgrade bị từ chối 401 khi thiếu/sai token — trước khi nâng cấp', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootAppForStreaming(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')
      const created = await fetch(`${base}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
      const { id: sessionId } = await created.json()

      await expect(connectWs(config.port!, `/sessions/${sessionId}/events/stream`, undefined)).rejects.toThrow(/401/)
      await expect(connectWs(config.port!, `/sessions/${sessionId}/events/stream`, 'Bearer sai-token')).rejects.toThrow(/401/)
    })
  })

  it('auth qua query string (?token=...) — cách duy nhất browser thật dùng được, không qua header', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootAppForStreaming(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')
      const created = await fetch(`${base}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
      const { id: sessionId } = await created.json()

      // Không set header authorization — mô phỏng đúng `new WebSocket(url)`
      // của trình duyệt, không có tham số headers.
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${config.port}/sessions/${sessionId}/events/stream?token=${encodeURIComponent(token)}`)
        socket.once('open', () => resolve(socket))
        socket.once('error', reject)
      })
      ws.close()

      await expect(
        new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${config.port}/sessions/${sessionId}/events/stream?token=sai-token`)
          socket.once('open', () => resolve(socket))
          socket.once('error', reject)
        }),
      ).rejects.toThrow(/401/)
    })
  })

  // Hành vi ĐỔI có chủ đích so với api-ws cũ: trước đây connect được luôn,
  // gửi send_message với id sai mới trả error frame; giờ session PHẢI có
  // thật (tạo qua REST) trước khi mở WS, nên id sai bị chặn ngay lúc upgrade.
  it('session không tồn tại -> upgrade bị từ chối 404 (không còn connect-rồi-nhận-error như trước)', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootAppForStreaming(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const { token } = await signupToken(base, 'alice')

      await expect(connectWs(config.port!, `/sessions/khong-ton-tai/events/stream`, `Bearer ${token}`)).rejects.toThrow(/404/)
    })
  })

  it('gap thật đã sửa: user KHÁC không xem được stream của session không phải mình -> 403 lúc upgrade', async () => {
    await withFreshSchemaUrl(async (databaseUrl) => {
      const { fiber, config } = await bootAppForStreaming(databaseUrl)
      cleanup = () => fiber.dispose()
      const base = `http://127.0.0.1:${config.port}`
      const alice = await signupToken(base, 'alice')
      const bob = await signupToken(base, 'bob')

      const created = await fetch(`${base}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${alice.token}` } })
      const { id: sessionId } = await created.json()

      await expect(connectWs(config.port!, `/sessions/${sessionId}/events/stream`, `Bearer ${bob.token}`)).rejects.toThrow(/403/)
    })
  })
})
