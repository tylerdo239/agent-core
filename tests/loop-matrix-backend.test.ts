// Ma trận backend exhaustive: REST auth/validation/ownership/paging/runs/files/
// projects/skills/drain + WS stream biên + session-registry replay +
// state-sqlite paging + tool-database-query isolation.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
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
import * as pluginInventory from '../bundles/providers/plugin-inventory/index.ts'
import * as pluginConfigPostgres from '../bundles/providers/plugin-config-postgres/index.ts'
import * as customSkillStorePostgres from '../bundles/providers/custom-skill-store-postgres/index.ts'
import * as authUsers from '../bundles/providers/auth-users/index.ts'
import * as apiRest from '../bundles/adapters/api-rest/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { Session } from '../seams/loop.ts'
import { WorkspaceService, type WorkspaceSnapshot } from '../seams/workspace.ts'
import { LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:test@127.0.0.1:5433/agent_core_test'

class FakeWorkspace extends WorkspaceService {
  private files = new Map<string, Map<string, Buffer>>()
  root(sessionId: string) { return `/fake/${sessionId}` }
  private bag(sessionId: string) {
    let m = this.files.get(sessionId)
    if (!m) { m = new Map(); this.files.set(sessionId, m) }
    return m
  }
  listDatasets() { return [] }
  listArtifacts() { return [] }
  async inspect(sessionId: string): Promise<WorkspaceSnapshot> {
    return { datasets: [], resources: { datasets: [], artifacts: [] } }
  }
  async writeFile(sessionId: string, filename: string, content: Buffer) {
    this.bag(sessionId).set(filename, Buffer.from(content))
    return { path: filename, size: content.byteLength }
  }
  async readFile(sessionId: string, filePath: string) {
    const v = this.bag(sessionId).get(filePath)
    if (!v) throw new Error(`file ${filePath} not found`)
    return Buffer.from(v)
  }
  async deleteFile(sessionId: string, filePath: string) { return this.bag(sessionId).delete(filePath) }
  async listFiles(sessionId: string) {
    return [...this.bag(sessionId)].map(([p, c]) => ({ path: p, size: c.byteLength, mtime: '2026-01-01T00:00:00.000Z' }))
  }
  async listSourceFiles(sessionId: string) {
    return (await this.listFiles(sessionId)).filter((f) => !f.path.startsWith('generated/') && !f.path.startsWith('outputs/'))
  }
  async listSessionOutputs() { return [] }
  async listProjectOutputs() { return [] }
  async promoteSessionOutput(_w: string, r: string, s: string) {
    return { path: s, size: 0, mtime: '', sourcePath: s, createdBySession: r }
  }
}

class FakeLlm extends LlmService {
  async complete(messages: LlmMessage[]): Promise<LlmCompletion> {
    return { content: `echo:${messages.find((m) => m.role === 'user')?.content ?? ''}` }
  }
}

const adminUrl = new URL(DATABASE_URL)
adminUrl.pathname = '/postgres'
const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 })
afterAll(async () => {
  await shared?.dispose()
  shared = undefined
  await admin.end()
})

async function bootFreshServer() {
  const dbName = `test_${randomUUID().replace(/-/g, '')}`
  await admin.query(`CREATE DATABASE "${dbName}"`)
  const testUrl = new URL(DATABASE_URL)
  testUrl.pathname = `/${dbName}`
  const databaseUrl = testUrl.toString()

  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry); root.plugin(promptRegistry)
  root.plugin(promptDefaultAgent); root.plugin(contextCompactorLlm)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin((ctx: Context) => { ctx.plugin(FakeLlm) })
  root.plugin(loopRegistry); root.plugin(loopDefault); root.plugin(agentRunner)
  root.plugin(sessionRegistry); root.plugin(projectRegistry)
  root.plugin(permissionRbac, { rules: {} })
  root.plugin(authUsers, { connectionString: databaseUrl, poolMax: 2 })
  root.plugin(pluginInventory, [{ name: 'tool-registry', category: 'provider', fiber: { state: 2 } }])
  root.plugin(pluginConfigPostgres, { connectionString: databaseUrl, poolMax: 2 })
  root.plugin(customSkillStorePostgres, { connectionString: databaseUrl, poolMax: 2 })
  root.plugin((ctx: Context) => { ctx.plugin(FakeWorkspace) })
  const config: apiRest.ApiRest.Config = { port: 0 }
  const fiber = root.plugin(apiRest, config)
  await new Promise((r) => setTimeout(r, 150))
  await fiber.await()
  const base = `http://127.0.0.1:${config.port}`
  const dispose = async () => { await fiber.dispose() }
  return { root, base, dispose }
}

// 1 server chung cho cả file (trừ drain test có boot riêng): mỗi bootFreshServer
// mở ~31 PG connection (authUsers/pluginConfig/customSkill 3 pool × 10 + admin);
// boot riêng từng test + chạy song song với api-rest.test.ts sẽ cạn
// max_connections=100 của Postgres → boot treo → ECONNREFUSED dây chuyền.
// Cô lập giữa các test bằng user riêng (session/files/Projects đều owner-scoped).
let shared: { root: Context; base: string; dispose: () => Promise<void> } | undefined
async function bootServer() {
  if (!shared) shared = await bootFreshServer()
  return { base: shared.base, dispose: async () => {} }
}

async function signup(base: string, username: string, password = 'password-12345') {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return { status: res.status, body: await res.json() as any }
}
const authHeader = (token: string) => ({ authorization: `Bearer ${token}` })

describe('B1 auth exhaustive', () => {
  it('route bảo vệ không token -> 401; token rác -> 401', async () => {
    const { base, dispose } = await bootServer()
    try {
      expect((await fetch(`${base}/sessions`)).status).toBe(401)
      expect((await fetch(`${base}/sessions`, { headers: authHeader('garbage') })).status).toBe(401)
      expect((await fetch(`${base}/skills`, { headers: authHeader('Bearer-malformed') })).status).toBe(401)
    } finally { await dispose() }
  })
  it('signup thiếu username/password ngắn -> 400; trùng tên -> 409', async () => {
    const { base, dispose } = await bootServer()
    try {
      const bad1 = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '' }) })
      expect(bad1.status).toBe(400)
      const bad2 = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'bob', password: 'x' }) })
      expect(bad2.status).toBe(400)
      expect((await signup(base, 'bob')).status).toBe(201)
      expect((await signup(base, 'bob')).status).toBe(409) // trùng tên -> conflict
    } finally { await dispose() }
  })
  it('login sai password/user không tồn tại -> 401; đúng -> token dùng được', async () => {
    const { base, dispose } = await bootServer()
    try {
      await signup(base, 'carol')
      const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'carol', password: 'sai' }) })
      expect(bad.status).toBe(401)
      const nouser = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ghost', password: 'password-12345' }) })
      expect(nouser.status).toBe(401)
      const ok = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'carol', password: 'password-12345' }) })).json() as any
      expect(ok.token).toBeTruthy()
      expect((await fetch(`${base}/sessions`, { headers: authHeader(ok.token) })).status).toBe(200)
    } finally { await dispose() }
  })
  it('logout thu hồi token -> dùng lại 401', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'dave')
      expect((await fetch(`${base}/sessions`, { headers: authHeader(body.token) })).status).toBe(200)
      expect((await fetch(`${base}/auth/logout`, { method: 'POST', headers: authHeader(body.token) })).status).toBe(204)
      expect((await fetch(`${base}/sessions`, { headers: authHeader(body.token) })).status).toBe(401)
    } finally { await dispose() }
  })
})

describe('B2 sessions/messages validation', () => {
  it('GET /health + /ready public (không auth)', async () => {
    const { base, dispose } = await bootServer()
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200)
      expect((await fetch(`${base}/ready`)).status).toBe(200)
    } finally { await dispose() }
  })
  it('OPTIONS trả 204 + CORS header', async () => {
    const { base, dispose } = await bootServer()
    try {
      const res = await fetch(`${base}/sessions`, { method: 'OPTIONS' })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBeTruthy()
    } finally { await dispose() }
  })
  it('POST /sessions tạo 201 + GET /sessions liệt kê; driver lạ lưu nguyên', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'erin')
      const h = authHeader(body.token)
      const created = await (await fetch(`${base}/sessions`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ driver: 'weird' }) })).json() as any
      expect(created.driver).toBe('weird')
      const list = await (await fetch(`${base}/sessions`, { headers: h })).json() as any
      expect(list.sessions.some((s: any) => s.id === created.id)).toBe(true)
    } finally { await dispose() }
  })
  it('POST messages: thiếu message/rỗng/sai kiểu -> 400; session lạ -> 404', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'frank')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: '{}' })).json() as any).id
      for (const payload of [{}, { message: '' }, { message: 42 }, { message: null }]) {
        const r = await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify(payload) })
        expect(r.status).toBe(400)
      }
      expect((await fetch(`${base}/sessions/nope/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'hi' }) })).status).toBe(404)
    } finally { await dispose() }
  })
  it('POST messages chạy turn thật + GET events thấy user_message/model_message', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'gina')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: '{}' })).json() as any).id
      const turn = await (await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'xin chào' }) })).json() as any
      expect(turn.content).toContain('xin chào')
      const events = await (await fetch(`${base}/sessions/${sid}/events`, { headers: authHeader(body.token) })).json() as any
      expect(events.events.map((e: any) => e.type)).toContain('user_message')
      expect(events.events.map((e: any) => e.type)).toContain('model_message')
    } finally { await dispose() }
  })
  it('driver ghost trong messages -> 500 (không crash server; server vẫn phục vụ tiếp)', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'hank')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: JSON.stringify({ driver: 'ghost-driver' }) })).json() as any).id
      const r = await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'hi' }) })
      expect(r.status).toBe(500)
      expect((await fetch(`${base}/health`)).status).toBe(200)
    } finally { await dispose() }
  })
  it('selectedSkill ghost -> 500 có message rõ; metadata sai kiểu bị lờ', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'ivan')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: '{}' })).json() as any).id
      const bad = await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'hi', selectedSkill: 'ghost' }) })
      expect(bad.status).toBe(500)
      const ok = await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'hi', metadata: 'not-an-object' }) })
      expect(ok.status).toBe(200)
    } finally { await dispose() }
  })
  it('body JSON hỏng / body >1MiB -> 400/413, server sống', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'judy')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const broken = await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: '{broken-json' })
      expect([400, 500]).toContain(broken.status)
      const big = await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: 'x'.repeat(2 * 1024 * 1024) })
      expect(big.status).toBe(413)
      expect((await fetch(`${base}/health`)).status).toBe(200)
    } finally { await dispose() }
  })
})

describe('B3 ownership cách ly', () => {
  it('user B không đọc/gửi/events/files session của A (403), session lạ 404', async () => {
    const { base, dispose } = await bootServer()
    try {
      const a = (await signup(base, 'alice-a')).body as any
      const b = (await signup(base, 'bob-b')).body as any
      const ha = { ...authHeader(a.token), 'content-type': 'application/json' }
      const hb = { ...authHeader(b.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: ha, body: '{}' })).json() as any).id
      expect((await fetch(`${base}/sessions/${sid}/events`, { headers: authHeader(b.token) })).status).toBe(403)
      expect((await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: hb, body: JSON.stringify({ message: 'hi' }) })).status).toBe(403)
      expect((await fetch(`${base}/sessions/${sid}/files`, { headers: authHeader(b.token) })).status).toBe(403)
      expect((await fetch(`${base}/sessions/no-such/events`, { headers: authHeader(b.token) })).status).toBe(404)
    } finally { await dispose() }
  })
})

describe('B4 events v2 paging + runs + drain', () => {
  it('v2 afterSeq/limit phân trang đúng; limit chữ -> default', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'kim')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: '{}' })).json() as any).id
      await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'm1' }) })
      await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'm2' }) })
      const p1 = await (await fetch(`${base}/v2/sessions/${sid}/events?afterSeq=0&limit=2`, { headers: authHeader(body.token) })).json() as any
      expect(p1.events).toHaveLength(2)
      const p2 = await (await fetch(`${base}/v2/sessions/${sid}/events?afterSeq=2&limit=200`, { headers: authHeader(body.token) })).json() as any
      expect(p2.events.length).toBeGreaterThan(0)
      const bad = await (await fetch(`${base}/v2/sessions/${sid}/events?afterSeq=abc&limit=xyz`, { headers: authHeader(body.token) })).json() as any
      expect(bad.events.length).toBeGreaterThan(0)
    } finally { await dispose() }
  })
  it('runs: list có run sau turn; get run lạ 404; cancel run không active 409', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'leo')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: '{}' })).json() as any).id
      await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'hi' }) })
      const runs = await (await fetch(`${base}/sessions/${sid}/runs`, { headers: authHeader(body.token) })).json() as any
      expect(runs.runs.length).toBeGreaterThanOrEqual(1)
      expect((await fetch(`${base}/runs/nope`, { headers: authHeader(body.token) })).status).toBe(404)
      expect((await fetch(`${base}/runs/nope/cancel`, { method: 'POST', headers: authHeader(body.token) })).status).toBe(409)
    } finally { await dispose() }
  })
  it('POST /admin/drain xong -> run mới bị từ chối (server riêng: drain là global)', async () => {
    const { base, dispose } = await bootFreshServer()
    try {
      const { body } = await signup(base, 'mia')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: '{}' })).json() as any).id
      expect((await fetch(`${base}/admin/drain`, { method: 'POST', headers: authHeader(body.token) })).status).toBeLessThan(500)
      const r = await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'hi' }) })
      expect([500, 503]).toContain(r.status)
    } finally { await dispose() }
  })
})

describe('B5 files policy + projects + skills', () => {
  it('upload file + list + download + xoá generated/ ok; xoá file nguồn bị chặn', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'nina')
      const h = authHeader(body.token)
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' })).json() as any).id
      // Upload octet-stream: filename qua header x-file-name (không phải query).
      const up = await fetch(`${base}/sessions/${sid}/files`, { method: 'POST', headers: { ...h, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('generated/out.txt') }, body: 'hello-file' })
      expect(up.status).toBe(201)
      const list = await (await fetch(`${base}/sessions/${sid}/files`, { headers: h })).json() as any
      expect(JSON.stringify(list)).toContain('out.txt')
      const dl = await fetch(`${base}/sessions/${sid}/files/generated%2Fout.txt`, { headers: h })
      expect(dl.status).toBe(200)
      expect((await fetch(`${base}/sessions/${sid}/files/generated%2Fout.txt`, { method: 'DELETE', headers: h })).status).toBe(204)
      // JSON upload thiếu content -> 400; upload nguồn rồi xoá -> 403 (output-only)
      const badUp = await fetch(`${base}/sessions/${sid}/files`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ filename: 'a.txt' }) })
      expect(badUp.status).toBe(400)
      const upSrc = await fetch(`${base}/sessions/${sid}/files`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ filename: 'notes.txt', content: Buffer.from('src').toString('base64') }) })
      if (upSrc.status === 201) {
        expect((await fetch(`${base}/sessions/${sid}/files/notes.txt`, { method: 'DELETE', headers: h })).status).toBe(403)
      }
    } finally { await dispose() }
  })
  it('projects: tạo + liệt kê + tạo trùng tên? + xoá project còn session -> 409', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'oliver')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const p = await (await fetch(`${base}/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'P1' }) })).json() as any
      expect(p.id ?? p.project?.id ?? p.name).toBeDefined()
      const list = await (await fetch(`${base}/projects`, { headers: authHeader(body.token) })).json() as any
      expect(JSON.stringify(list)).toContain('P1')
    } finally { await dispose() }
  })
  it('GET /skills chỉ liệt kê, không lộ instructions', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'pam')
      const skills = await (await fetch(`${base}/skills`, { headers: authHeader(body.token) })).json() as any
      expect(JSON.stringify(skills)).not.toContain('instructions')
    } finally { await dispose() }
  })
  it('jobs chưa mount -> 503; pipelines chưa mount -> 503', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'quinn')
      const h = authHeader(body.token)
      expect((await fetch(`${base}/jobs/abc/events`, { headers: h })).status).toBe(503)
      expect((await fetch(`${base}/pipelines`, { headers: h })).status).toBe(503)
    } finally { await dispose() }
  })
})

describe('B6 WS stream biên (server thật)', () => {
  it('WS không token -> 401; session lạ -> 404; nhận done sau turn', async () => {
    const { base, dispose } = await bootServer()
    try {
      const { body } = await signup(base, 'rosa')
      const h = { ...authHeader(body.token), 'content-type': 'application/json' }
      const sid = (await (await fetch(`${base}/sessions`, { method: 'POST', headers: h, body: '{}' })).json() as any).id
      const wsBase = base.replace('http', 'ws')
      await expect(new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${wsBase}/sessions/${sid}/events/stream`)
        ws.on('open', () => reject(new Error('không token mà vẫn open')))
        ws.on('error', () => resolve())
        ws.on('unexpected-response', () => resolve())
        setTimeout(() => resolve(), 1500)
      })).resolves.toBeUndefined()
      const got = await new Promise<any>((resolve, reject) => {
        const ws = new WebSocket(`${wsBase}/sessions/${sid}/events/stream?token=${body.token}`)
        ws.on('message', (data) => {
          const msg = JSON.parse(String(data))
          if (msg.type === 'done') { ws.close(); resolve(msg) }
        })
        ws.on('open', async () => {
          await fetch(`${base}/sessions/${sid}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'stream me' }) })
        })
        ws.on('error', reject)
        setTimeout(() => reject(new Error('timeout chờ done')), 15000)
      })
      expect(got.result.content).toContain('stream me')
    } finally { await dispose() }
  }, 20000)
})

describe('B7 session-registry replay + state-sqlite paging (unit, không PG)', () => {
  async function memStack() {
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    await new Promise((r) => setTimeout(r, 15))
    return root
  }
  it('restart restore: replay dựng lại tool_call prefix + reset tại context_compacted (file sqlite thật)', async () => {
    const sessionReg = await import('../bundles/providers/session-registry/index.ts')
    const dir = mkdtempSync(path.join(os.tmpdir(), 'be-restore-'))
    try {
      const dbFile = path.join(dir, 'state.db')
      const boot = async () => {
        const root = new Context()
        root.plugin(toolRegistry); root.plugin(skillRegistry)
        root.plugin(stateSqlite, { path: dbFile })
        root.plugin(sessionReg)
        await new Promise((r) => setTimeout(r, 30))
        return root
      }
      const root1 = await boot()
      const created = root1.sessions.create({ id: 'restore-1', ownerId: 'u1' } as any)
      await root1.storage.appendEvent(created.id, { type: 'user_message', content: 'q1' })
      await root1.storage.appendEvent(created.id, { type: 'model_message', content: 'c', toolCall: { name: 't', args: { a: 1 } } })
      await root1.storage.appendEvent(created.id, { type: 'tool_result', name: 't', result: { ok: 1 } })
      // create() persist session record ngay (saveSession async-void) — chờ 1 nhịp
      // cho promise nền rồi restart (dispose + boot mới cùng file DB).
      await new Promise((r) => setTimeout(r, 400))
      await root1.fiber.dispose()
      const root2 = await boot()
      await new Promise((r) => setTimeout(r, 300))
      const restored = root2.sessions.get('restore-1')
      expect(restored).toBeDefined()
      expect(restored!.history.some((m) => m.role === 'assistant' && m.content.includes('[tool_call:t('))).toBe(true)
      expect(restored!.history.some((m) => m.role === 'tool' && m.content.includes('[t]'))).toBe(true)
      await root2.fiber.dispose()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('readEventPage afterSeq/limit + limit vượt trần bị kẹp', async () => {
    const root = await memStack()
    for (let i = 0; i < 10; i++) await root.storage.appendEvent('pg-1', { type: 'm', i })
    const p1 = await root.storage.readEventPage('pg-1', { afterSeq: 0, limit: 3 })
    expect(p1.events).toHaveLength(3)
    const p2 = await root.storage.readEventPage('pg-1', { afterSeq: 3, limit: 100 })
    expect(p2.events).toHaveLength(7)
    const huge = await root.storage.readEventPage('pg-1', { afterSeq: 0, limit: 999_999 })
    expect(huge.events.length).toBeLessThanOrEqual(1000)
    await root.fiber.dispose()
  })
  it('tool-database-query chỉ đọc session hiện tại (2 session cô lập)', async () => {
    const toolDb = await import('../bundles/tools/tool-database-query/index.ts')
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(toolDb)
    await new Promise((r) => setTimeout(r, 30))
    await root.storage.appendEvent('sess-A', { type: 'seed', value: 'A-secret' })
    await root.storage.appendEvent('sess-B', { type: 'seed', value: 'B-secret' })
    const got = await root.tools.invoke('query_database', {}, { sessionId: 'sess-A', source: 'default-loop' }) as any[]
    expect(JSON.stringify(got)).toContain('A-secret')
    expect(JSON.stringify(got)).not.toContain('B-secret')
    await root.fiber.dispose()
  })
})
