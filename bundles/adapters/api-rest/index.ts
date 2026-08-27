// bundles/api-rest — Phase 6.1: REST adapter qua ctx.sessions/ctx.agent/ctx.storage.
// Phase 6.3 (gộp WS): bundle này giờ sở hữu 1 http.Server DUY NHẤT phục vụ cả
// REST route lẫn WS upgrade (`GET /sessions/:id/events/stream`) — tham khảo
// dsh (`docs/api-gateway.md` + note kiến trúc 2026-08-04-websocket-downlink-
// carrier.md của họ): HTTP là nguồn sự thật duy nhất cho mọi lệnh có
// request/response (tạo session, gửi message); WebSocket chỉ downlink một
// chiều (step/done/error), không nhận message nghiệp vụ từ client nữa —
// tránh 2 lần cài đặt trùng nhau cho cùng 1 nghiệp vụ (create_session/
// send_message) từng tồn tại song song ở bundles/adapters/api-ws (đã xoá).
//
// Dùng thẳng `node:http` — không thêm framework (coding rule A6, chỉ endpoint
// ít, không cần routing phức tạp). `apply` tự thân là async, mở server
// rồi return disposer trực tiếp (coding rule A13) — cùng kỷ luật lifecycle
// như mọi provider khác trong repo: mount → unmount phải đóng cổng sạch, có
// test xác nhận (giống pattern Phase 2 cho SQLite).
//
// Bundle này KHÔNG đăng ký vào registry nào khác (khác loop driver) — chính
// nó sở hữu server của nó (giờ là 1 server duy nhất cho cả 2 protocol), nên
// rule A12 không áp dụng: handler route (kể cả handler WS upgrade/connection)
// được phép đóng gói `ctx` từ `apply()` của chính bundle này, vì fiber sở
// hữu handler và fiber sở hữu server luôn là MỘT, dispose cùng lúc.
//
// Production hardening: MỌI request (trừ /health, /ready, /auth/signup,
// /auth/login) phải có `Authorization: Bearer <token>` hợp lệ qua
// ctx.auth.verify() — coding rule B1 (chạm resource phải tự check, không
// giả định caller đã check hộ). Body giới hạn kích thước — request lớn hơn
// bị từ chối trước khi đọc hết, tránh 1 request ăn hết RAM process. WS
// upgrade cũng auth NGAY LÚC HANDSHAKE (trước khi nâng cấp), cùng nguyên tắc.
//
// Module auth (nhiều người dùng thật): verify() giờ trả về AuthIdentity
// (không còn boolean thuần) — mọi session tạo mới gắn `ownerId` từ CHÍNH
// identity đã verify (KHÔNG BAO GIỜ từ field client tự khai trong body).
// GET /sessions/:id/events, POST /sessions/:id/messages, và WS upgrade đều
// check thêm quyền sở hữu (canAccessSession) SAU khi xác nhận session tồn
// tại — thiếu bước này thì bất kỳ token hợp lệ nào cũng đọc/ghi được session
// của người khác, chỉ cần biết/đoán đúng id (gap thật, không phải giả thuyết).
//
// CORS: bật cho MỌI request REST — cần thiết ngay khi có browser client
// (frontend serve ở apps/web/dist qua bundles/adapters/web-ui, port khác =
// origin khác theo trình duyệt), độc lập với việc mạng có internet-facing
// hay không. An toàn để mặc định `*` vì auth ở đây dùng Bearer token
// (browser không tự đính kèm như cookie) — không có rủi ro CSRF kiểu
// cookie-based, khác hẳn hệ thống dùng session cookie.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/sessions.ts'
import '../../../seams/agent.ts'
import '../../../seams/storage.ts'
import '../../../seams/permission.ts'
import '../../../seams/auth.ts'
import { AuthIdentity } from '../../../seams/auth.ts'
import { LoopStep, LoopTurnResult, Session } from '../../../seams/loop.ts'
import '../../../seams/skill.ts'
import '../../../seams/custom-skills.ts'
import '../../../seams/workspace.ts'
import '../../../seams/jobs.ts'
import '../../../seams/artifacts.ts'
import '../../../seams/pipeline.ts'
import '../../../seams/projects.ts'
import { Project } from '../../../seams/projects.ts'

export namespace ApiRest {
  export interface Config {
    /** 0 = để OS tự chọn cổng trống (dùng trong test); mặc định 8787 cho chạy tay. */
    port?: number
    /** Giới hạn body request (byte) — mặc định 1 MiB. */
    maxBodyBytes?: number
    /** Access-Control-Allow-Origin — mặc định "*" (xem ghi chú CORS ở đầu file). */
    corsOrigin?: string
    /** Giới hạn 1 message WS downlink (byte) — mặc định 1 MiB. Client không gửi message nghiệp vụ nên hiếm khi chạm; vẫn giữ giới hạn để chặn frame rác khổng lồ. */
    wsMaxPayloadBytes?: number
    onListening?: (port: number) => void
  }
}

export const inject = ['sessions', 'projects', 'agent', 'storage', 'auth', 'permission', 'skills', 'customSkills', 'workspace', 'pluginInventory', 'pluginConfig', 'tools']

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 // 1 MiB
const FILE_MAX_BODY_BYTES = 70 * 1024 * 1024 // 70 MiB for uploads
const DEFAULT_WS_MAX_PAYLOAD_BYTES = 1024 * 1024 // 1 MiB

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) {
      throw Object.assign(new Error(`request body exceeds ${maxBytes} bytes`), { status: 413 })
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const body = await readBody(req, maxBytes)
  if (!body.length) return {}
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 })
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(json)
}

function extractBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return undefined
  return header.slice('Bearer '.length)
}

/** Đúng chủ sở hữu HOẶC admin — dùng cho mọi endpoint chạm 1 session cụ thể. */
function canAccessSession(identity: AuthIdentity, session: Session): boolean {
  return identity.role === 'admin' || session.ownerId === identity.userId
}

function canAccessProject(identity: AuthIdentity, project: Project): boolean {
  return identity.role === 'admin' || project.ownerId === identity.userId
}

function projectForSession(ctx: Context, session: Session): Project | undefined {
  return session.projectId ? ctx.projects.get(session.projectId) : undefined
}

function sessionProjectIsValid(ctx: Context, identity: AuthIdentity, session: Session): boolean {
  if (!session.projectId) return true
  const project = projectForSession(ctx, session)
  return Boolean(project && project.ownerId === session.ownerId && canAccessProject(identity, project))
}

async function handleWorkspaceFiles(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  workspaceId: string,
  subPath: string | null,
) {
  if (req.method === 'GET' && !subPath) {
    const files = await ctx.workspace.listFiles(workspaceId)
    const snapshot = await ctx.workspace.inspect(workspaceId)
    return sendJson(res, 200, { files, datasets: snapshot.resources?.datasets ?? [], artifacts: snapshot.resources?.artifacts ?? [] })
  }
  if (req.method === 'GET' && subPath) {
    try {
      const buf = await ctx.workspace.readFile(workspaceId, subPath)
      const ext = subPath.split('.').pop()?.toLowerCase() ?? ''
      const mime: Record<string, string> = { csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', txt: 'text/plain', html: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' }
      res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream', 'content-disposition': `attachment; filename="${encodeURIComponent(subPath.split('/').pop()!)}"` })
      return res.end(buf)
    } catch (error) {
      return sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (req.method === 'DELETE' && subPath) {
    // User-facing delete is intentionally output-only. Source datasets are
    // project inputs and must not disappear because of a misplaced UI click.
    const outputPath = subPath.startsWith('generated/')
      || subPath.startsWith('outputs/')
      || /^\.sessions\/[^/]+\/generated\//.test(subPath)
    if (!outputPath) return sendJson(res, 403, { error: 'only output files can be deleted' })
    try {
      const deleted = await ctx.workspace.deleteFile(workspaceId, subPath)
      if (!deleted) return sendJson(res, 404, { error: 'output file not found' })
      res.writeHead(204)
      return res.end()
    } catch (error) {
      return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (req.method === 'POST' && !subPath) {
    let filename = ''
    if ((req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() === 'application/octet-stream') {
      const rawName = Array.isArray(req.headers['x-file-name']) ? req.headers['x-file-name'][0] : req.headers['x-file-name']
      try { filename = decodeURIComponent(String(rawName ?? '')) } catch { filename = '' }
      if (!filename) return sendJson(res, 400, { error: 'filename is required' })
      try {
        const result = await ctx.workspace.writeFileFromStream(workspaceId, filename, req, { maxBytes: FILE_MAX_BODY_BYTES })
        return sendJson(res, 201, { path: result.path, size: result.size })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return sendJson(res, /exceeds/.test(message) ? 413 : 500, { error: message })
      }
    }
    const body = await readJsonBody(req, Math.ceil(FILE_MAX_BODY_BYTES * 4 / 3) + 1024)
    filename = typeof body.filename === 'string' ? body.filename : ''
    const content = typeof body.content === 'string' ? body.content : ''
    if (!filename || !content) return sendJson(res, 400, { error: 'filename and content are required' })
    const buf = body.encoding === 'utf8' ? Buffer.from(content, 'utf8') : Buffer.from(content, 'base64')
    if (buf.byteLength > FILE_MAX_BODY_BYTES) return sendJson(res, 413, { error: 'file too large' })
    const result = await ctx.workspace.writeFile(workspaceId, filename, buf)
    return sendJson(res, 201, { path: result.path, size: result.size })
  }
  return sendJson(res, 405, { error: 'method not allowed' })
}

const PUBLIC_PATHS = new Set(['/health', '/ready', '/auth/signup', '/auth/login'])

// ── WS downlink (Phase 6.3, port từ bundles/adapters/api-ws đã xoá) ──────────

const WS_STREAM_PATH = /^\/sessions\/([^/]+)\/events\/stream$/

/**
 * Token cho WS lấy từ 2 nguồn (header trước, query string sau) — KHÔNG phải
 * 1 trong 2 là đủ cho mọi client thật: `new WebSocket(url)` theo Web spec
 * KHÔNG có tham số set custom header (khác client Node package `ws` dùng
 * trong test, có hỗ trợ `{ headers }`). Browser thật (apps/web) PHẢI dùng
 * query string (`?token=...`); giữ header cho client Node hiện có.
 */
function extractWsToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length)
  const url = new URL(req.url ?? '/', 'http://localhost')
  return url.searchParams.get('token') ?? undefined
}

function sendWs(ws: WebSocket, payload: unknown) {
  ws.send(JSON.stringify(payload))
}

/** Từ chối upgrade bằng 1 HTTP status thật TRƯỚC khi nâng cấp — không accept-rồi-đóng. */
function rejectUpgrade(socket: Duplex, status: number) {
  const statusText: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' }
  socket.write(`HTTP/1.1 ${status} ${statusText[status] ?? 'Bad Request'}\r\n\r\n`)
  socket.destroy()
}

async function handleUpgrade(ctx: Context, wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const match = pathname.match(WS_STREAM_PATH)
  if (!match) return rejectUpgrade(socket, 404)

  const identity = await ctx.auth.verify(extractWsToken(req))
  if (!identity) return rejectUpgrade(socket, 401)

  const session = ctx.sessions.get(match[1])
  if (!session) return rejectUpgrade(socket, 404)
  if (!canAccessSession(identity, session)) return rejectUpgrade(socket, 403)

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, session)
  })
}

// LƯU Ý (coding rule A13): `apply` ở đây PHẢI là `async` và return disposer
// TRỰC TIẾP (Promise<Disposable>) — không bọc qua `ctx.effect()` bên trong 1
// `apply` đồng bộ. Đã verify thực nghiệm: nếu `apply` đồng bộ chỉ *gọi*
// `ctx.effect(async () => {...})` mà không tự await/return nó, fiber bao
// ngoài coi như "load xong" ngay khi `apply()` return (gần như đồng bộ) —
// KHÔNG đợi effect bất đồng bộ bên trong hoàn tất. `await fiber.await()` ở
// nơi gọi sẽ resolve TRƯỚC KHI server thật sự listen — race condition thật,
// không phải giả thuyết.
export const apply = async (ctx: Context, config: ApiRest.Config = {}) => {
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const corsOrigin = config.corsOrigin ?? '*'
  const wsMaxPayloadBytes = config.wsMaxPayloadBytes ?? DEFAULT_WS_MAX_PAYLOAD_BYTES

  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', corsOrigin)
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type, authorization, x-file-name')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }
    handle(ctx, req, res, maxBodyBytes).catch((err: any) => {
      ctx.logger('api-rest').error(err)
      if (!res.headersSent) sendJson(res, err?.status ?? 500, { error: err?.message ?? 'internal error' })
    })
  })

  // `noServer: true` — TỰ dispatch upgrade thay vì cho `ws` chiếm hẳn server
  // (khác `{ port }` độc lập của bundle api-ws cũ): server.listen() chỉ gọi
  // 1 LẦN duy nhất bên dưới, dùng chung cho cả REST lẫn WS upgrade.
  const wss = new WebSocketServer({ noServer: true, maxPayload: wsMaxPayloadBytes })

  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(ctx, wss, req, socket, head).catch((err: any) => {
      ctx.logger('api-rest').error(err)
      socket.destroy()
    })
  })

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, session: Session) => {
    // Downlink-only: KHÔNG có ws.on('message', ...) — WS không nhận message
    // nghiệp vụ từ client nữa (xem header file). Chỉ forward 3 event, lọc
    // theo đúng sessionId của socket này, gỡ hết khi socket đóng.
    const onStep = (e: { sessionId: string; step: LoopStep }) => {
      if (e.sessionId !== session.id) return
      sendWs(ws, { type: 'step', sessionId: e.sessionId, step: e.step })
    }
    const onDone = (e: { sessionId: string; result: LoopTurnResult }) => {
      if (e.sessionId !== session.id) return
      sendWs(ws, { type: 'done', sessionId: e.sessionId, result: e.result })
    }
    const onError = (e: { sessionId: string; message: string }) => {
      if (e.sessionId !== session.id) return
      sendWs(ws, { type: 'error', message: e.message })
    }
    const offStep = ctx.on('agent/step', onStep)
    const offDone = ctx.on('agent/turn-done', onDone)
    const offError = ctx.on('agent/turn-error', onError)
    ws.on('close', () => {
      offStep()
      offDone()
      offError()
    })
  })

  await new Promise<void>((resolve) => server.listen(config.port ?? 8787, resolve))
  const address = server.address()
  if (address && typeof address === 'object') {
    config.port = address.port
    config.onListening?.(address.port)
  }
  ctx.logger('api-rest').info('listening on :%d (REST + WS /sessions/:id/events/stream)', config.port)

  return () =>
    new Promise<void>((resolve, reject) => {
      // A4: mount → unmount → 0 resource leak — chủ động terminate mọi
      // socket WS còn mở trước khi đóng server, không dựa vào client tự đóng.
      for (const client of wss.clients) client.terminate()
      wss.close(() => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    })
}

async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse, maxBodyBytes: number) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const { pathname } = url

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { status: 'ok' })
  }

  if (req.method === 'GET' && pathname === '/ready') {
    // readiness thật — không chỉ "process còn sống" (như /health) mà "sẵn
    // sàng xử lý request" (dependency chain đã hội tụ đủ).
    const ready = ['sessions', 'agent', 'storage', 'auth'].every((name) => ctx.reflect.get(name, false) !== undefined)
    return sendJson(res, ready ? 200 : 503, { ready })
  }

  if (req.method === 'POST' && pathname === '/auth/signup') {
    const body = await readJsonBody(req, maxBodyBytes)
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      return sendJson(res, 400, { error: '"username" và "password" (string) là bắt buộc' })
    }
    const result = await ctx.auth.signup(body.username, body.password)
    return sendJson(res, 201, result)
  }

  if (req.method === 'POST' && pathname === '/auth/login') {
    const body = await readJsonBody(req, maxBodyBytes)
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      return sendJson(res, 400, { error: '"username" và "password" (string) là bắt buộc' })
    }
    const result = await ctx.auth.login(body.username, body.password)
    return sendJson(res, 200, result)
  }

  const identity = await ctx.auth.verify(extractBearerToken(req))
  if (!PUBLIC_PATHS.has(pathname) && !identity) {
    return sendJson(res, 401, { error: 'unauthorized' })
  }
  // Từ đây trở đi identity LUÔN tồn tại (path public đã return ở trên).

  if (req.method === 'POST' && pathname === '/auth/logout') {
    await ctx.auth.logout(extractBearerToken(req)!)
    res.writeHead(204)
    return res.end()
  }

  if (req.method === 'GET' && pathname === '/sessions') {
    // Chỉ liệt kê session CỦA CHÍNH caller (admin thấy hết) — ctx.sessions
    // (session-registry) in-memory, TTL trượt, mất khi restart: đây là danh
    // sách hội thoại còn "sống", KHÔNG phải kho lưu lịch sử vĩnh viễn (xem
    // README "Giới hạn hiện tại").
    const all = ctx.sessions.list()
    const mine = identity!.role === 'admin' ? all : all.filter((s) => s.ownerId === identity!.userId)
    return sendJson(res, 200, { sessions: mine.map((s) => ({ id: s.id, driver: s.driver, maxSteps: s.maxSteps, createdAt: s.createdAt, projectId: s.projectId })) })
  }

  if (req.method === 'GET' && pathname === '/projects') {
    const projects = ctx.projects.list().filter((project) => canAccessProject(identity!, project))
    return sendJson(res, 200, { projects })
  }
  if (req.method === 'POST' && pathname === '/projects') {
    const body = await readJsonBody(req, maxBodyBytes)
    if (typeof body.name !== 'string' || !body.name.trim()) return sendJson(res, 400, { error: 'project name is required' })
    const project = ctx.projects.create({ name: body.name, ownerId: identity!.userId })
    return sendJson(res, 201, { project })
  }

  const projectSessionsMatch = pathname.match(/^\/projects\/([^/]+)\/sessions$/)
  if (projectSessionsMatch) {
    const project = ctx.projects.get(projectSessionsMatch[1])
    if (!project) return sendJson(res, 404, { error: 'project not found' })
    if (!canAccessProject(identity!, project)) return sendJson(res, 403, { error: 'forbidden' })
    if (req.method === 'GET') {
      const sessions = ctx.sessions.list().filter((session) => session.projectId === project.id && canAccessSession(identity!, session))
      return sendJson(res, 200, { sessions: sessions.map((session) => ({ id: session.id, driver: session.driver, maxSteps: session.maxSteps, createdAt: session.createdAt, projectId: session.projectId })) })
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req, maxBodyBytes)
      const session = ctx.sessions.create({
        driver: 'rlm', projectId: project.id, ownerId: identity!.userId,
        maxSteps: typeof body.maxSteps === 'number' ? body.maxSteps : undefined,
      })
      ctx.projects.touch(project.id)
      return sendJson(res, 201, { id: session.id, driver: session.driver, projectId: session.projectId })
    }
  }

  const projectOutputsMatch = pathname.match(/^\/projects\/([^/]+)\/outputs(?:\/(project|session)\/([^/]+)(?:\/(.+))?)?$/)
  if (projectOutputsMatch) {
    const project = ctx.projects.get(projectOutputsMatch[1])
    if (!project) return sendJson(res, 404, { error: 'project not found' })
    if (!canAccessProject(identity!, project)) return sendJson(res, 403, { error: 'forbidden' })
    const workspaceId = `project:${project.id}`
    const scope = projectOutputsMatch[2]
    if (req.method === 'GET' && !scope) {
      const projectOutputs = await ctx.workspace.listProjectOutputs(workspaceId)
      const projectSessions = ctx.sessions.list().filter((session) => session.projectId === project.id && canAccessSession(identity!, session))
      const sessionOutputs = await Promise.all(projectSessions.map(async (session) => ({
        sessionId: session.id,
        files: await ctx.workspace.listSessionOutputs(workspaceId, session.id),
      })))
      return sendJson(res, 200, { projectOutputs, sessionOutputs })
    }
    if (req.method === 'POST' && !scope) {
      const body = await readJsonBody(req, maxBodyBytes)
      const session = typeof body.sessionId === 'string' ? ctx.sessions.get(body.sessionId) : undefined
      if (!session || session.projectId !== project.id || !canAccessSession(identity!, session)) {
        return sendJson(res, 404, { error: 'project conversation not found' })
      }
      if (typeof body.path !== 'string' || !body.path.trim()) return sendJson(res, 400, { error: 'output path is required' })
      try {
        const output = await ctx.workspace.promoteSessionOutput(
          workspaceId,
          session.id,
          body.path,
          typeof body.name === 'string' ? body.name : undefined,
        )
        ctx.projects.touch(project.id)
        return sendJson(res, 201, { output })
      } catch (error) {
        return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    }
    if ((req.method === 'GET' || req.method === 'DELETE') && scope && projectOutputsMatch[3]) {
      const owner = decodeURIComponent(projectOutputsMatch[3])
      const rawPath = scope === 'project'
        ? decodeURIComponent([projectOutputsMatch[3], projectOutputsMatch[4]].filter(Boolean).join('/'))
        : projectOutputsMatch[4] ? decodeURIComponent(projectOutputsMatch[4]) : ''
      if (!rawPath) return sendJson(res, 400, { error: 'output path is required' })
      let storedPath: string
      if (scope === 'project') {
        storedPath = rawPath.startsWith('legacy/') ? `generated/${rawPath.slice('legacy/'.length)}` : `outputs/${rawPath}`
      } else {
        const session = ctx.sessions.get(owner)
        if (!session || session.projectId !== project.id || !canAccessSession(identity!, session)) {
          return sendJson(res, 404, { error: 'project conversation not found' })
        }
        storedPath = `.sessions/${session.id}/generated/${rawPath.replace(/^generated\//, '')}`
      }
      const result = await handleWorkspaceFiles(ctx, req, res, workspaceId, storedPath)
      if (req.method === 'DELETE' && res.statusCode < 400) ctx.projects.touch(project.id)
      return result
    }
    return sendJson(res, 405, { error: 'method not allowed' })
  }

  const projectSourcesMatch = pathname.match(/^\/projects\/([^/]+)\/sources(?:\/(.+))?$/)
  if (projectSourcesMatch) {
    const project = ctx.projects.get(projectSourcesMatch[1])
    if (!project) return sendJson(res, 404, { error: 'project not found' })
    if (!canAccessProject(identity!, project)) return sendJson(res, 403, { error: 'forbidden' })
    const workspaceId = `project:${project.id}`
    if (req.method === 'GET' && !projectSourcesMatch[2]) {
      const snapshot = await ctx.workspace.inspect(workspaceId)
      return sendJson(res, 200, {
        sources: await ctx.workspace.listSourceFiles(workspaceId),
        datasets: snapshot.resources?.datasets ?? [],
      })
    }
    const result = await handleWorkspaceFiles(
      ctx,
      req,
      res,
      workspaceId,
      projectSourcesMatch[2] ? decodeURIComponent(projectSourcesMatch[2]) : null,
    )
    if (req.method === 'POST' && res.statusCode < 400) ctx.projects.touch(project.id)
    return result
  }

  const projectFilesMatch = pathname.match(/^\/projects\/([^/]+)\/files(?:\/(.+))?$/)
  if (projectFilesMatch) {
    const project = ctx.projects.get(projectFilesMatch[1])
    if (!project) return sendJson(res, 404, { error: 'project not found' })
    if (!canAccessProject(identity!, project)) return sendJson(res, 403, { error: 'forbidden' })
    const result = await handleWorkspaceFiles(ctx, req, res, `project:${project.id}`, projectFilesMatch[2] ? decodeURIComponent(projectFilesMatch[2]) : null)
    if (req.method === 'POST' && res.statusCode < 400) ctx.projects.touch(project.id)
    return result
  }

  const projectMatch = pathname.match(/^\/projects\/([^/]+)$/)
  if (projectMatch) {
    const project = ctx.projects.get(projectMatch[1])
    if (!project) return sendJson(res, 404, { error: 'project not found' })
    if (!canAccessProject(identity!, project)) return sendJson(res, 403, { error: 'forbidden' })
    if (req.method === 'GET') return sendJson(res, 200, { project })
    if (req.method === 'PATCH') {
      const body = await readJsonBody(req, maxBodyBytes)
      if (typeof body.name !== 'string' || !body.name.trim()) return sendJson(res, 400, { error: 'project name is required' })
      return sendJson(res, 200, { project: ctx.projects.rename(project.id, body.name) })
    }
    if (req.method === 'DELETE') {
      if (ctx.sessions.list().some((session) => session.projectId === project.id)) return sendJson(res, 409, { error: 'project still has conversations' })
      ctx.projects.remove(project.id)
      res.writeHead(204); return res.end()
    }
  }

  if (req.method === 'GET' && pathname === '/users') {
    if (!(await ctx.permission.check(identity!.role, 'admin:users:manage'))) return sendJson(res, 403, { error: 'forbidden' })
    return sendJson(res, 200, { users: await ctx.auth.listUsers() })
  }

  const userMatch = pathname.match(/^\/users\/([^/]+)$/)
  if (req.method === 'PATCH' && userMatch) {
    if (!(await ctx.permission.check(identity!.role, 'admin:users:manage'))) return sendJson(res, 403, { error: 'forbidden' })
    const body = await readJsonBody(req, maxBodyBytes)
    if (body.role !== undefined && body.role !== 'admin' && body.role !== 'user') {
      return sendJson(res, 400, { error: '"role" phải là "admin" hoặc "user"' })
    }
    if (body.role !== undefined) await ctx.auth.setRole(userMatch[1], body.role)
    if (body.active !== undefined) await ctx.auth.setActive(userMatch[1], !!body.active)
    const user = (await ctx.auth.listUsers()).find((u) => u.id === userMatch[1])
    if (!user) return sendJson(res, 404, { error: `user "${userMatch[1]}" không tồn tại` })
    return sendJson(res, 200, { user })
  }
  if (req.method === 'DELETE' && userMatch) {
    if (!(await ctx.permission.check(identity!.role, 'admin:users:manage'))) return sendJson(res, 403, { error: 'forbidden' })
    await ctx.auth.deleteUser(userMatch[1])
    res.writeHead(204)
    return res.end()
  }

  // docs: seams/plugin-inventory.ts — snapshot Fiber sống, admin-only cùng
  // action riêng 'admin:plugins:view' (KHÔNG tái dùng 'admin:users:manage' —
  // 2 khả năng khác nhau, tách rule để sau này có thể cấp lẻ từng cái).
  if (req.method === 'GET' && pathname === '/plugins') {
    if (!(await ctx.permission.check(identity!.role, 'admin:plugins:view'))) return sendJson(res, 403, { error: 'forbidden' })
    return sendJson(res, 200, { plugins: ctx.pluginInventory.list() })
  }

  // docs: seams/plugin-config.ts — cấu hình plugin (vd. serperApiKey) admin
  // đổi được qua UI, không cần restart (ctx.pluginConfig, Postgres). Action
  // riêng 'admin:plugins:configure' (khác 'admin:plugins:view' — xem/sửa là
  // 2 quyền khác nhau). CHỈ trả danh sách key ĐANG có giá trị — không bao
  // giờ trả giá trị thật qua GET, secret không rời DB qua đường này (đúng
  // pattern dsh: "a key control starts blank, reports only whether one is
  // configured" — xem docs/agent-core-adding-plugins.md tinh thần tương tự).
  if (req.method === 'GET' && pathname === '/plugin-settings') {
    if (!(await ctx.permission.check(identity!.role, 'admin:plugins:configure'))) return sendJson(res, 403, { error: 'forbidden' })
    return sendJson(res, 200, { configured: await ctx.pluginConfig.listConfiguredKeys() })
  }

  const pluginSettingMatch = pathname.match(/^\/plugin-settings\/([^/]+)$/)
  if (req.method === 'PUT' && pluginSettingMatch) {
    if (!(await ctx.permission.check(identity!.role, 'admin:plugins:configure'))) return sendJson(res, 403, { error: 'forbidden' })
    const body = await readJsonBody(req, maxBodyBytes)
    if (typeof body.value !== 'string' || !body.value) {
      return sendJson(res, 400, { error: '"value" phải là chuỗi không rỗng' })
    }
    await ctx.pluginConfig.set(pluginSettingMatch[1], body.value)
    return sendJson(res, 200, { key: pluginSettingMatch[1], configured: true })
  }
  if (req.method === 'DELETE' && pluginSettingMatch) {
    if (!(await ctx.permission.check(identity!.role, 'admin:plugins:configure'))) return sendJson(res, 403, { error: 'forbidden' })
    await ctx.pluginConfig.delete(pluginSettingMatch[1])
    res.writeHead(204)
    return res.end()
  }

  // docs: seams/tools.ts (ToolDefinition.configSchema) — tool TỰ khai field
  // cấu hình của chính nó (thay vì 1 catalog hardcode ở tầng UI), nên tool
  // bên thứ 3 nạp qua EXTRA_PLUGINS cũng tự động xuất hiện đúng ở đây, không
  // cần sửa source lõi. Cùng action 'admin:plugins:configure' — đọc SCHEMA
  // (tên field/nhãn), không phải giá trị thật.
  if (req.method === 'GET' && pathname === '/tool-config-schema') {
    if (!(await ctx.permission.check(identity!.role, 'admin:plugins:configure'))) return sendJson(res, 403, { error: 'forbidden' })
    const entries = ctx.tools.list().flatMap((def) => (def.configSchema ?? []).map((field) => ({ toolName: def.name, ...field })))
    return sendJson(res, 200, { entries })
  }

  if (req.method === 'GET' && pathname === '/skills') {
    const skills = ctx.skills
      .list({ userInvocableOnly: true, topLevelOnly: true, visibleTo: identity!.userId })
      .map(({ name, description }) => ({ name, description }))
    return sendJson(res, 200, { skills })
  }

  // docs: docs/agent-core-user-custom-skill-plan.md — skill riêng do user tự
  // thêm (ctx.customSkills, Postgres, không cần restart). Sở hữu chính mình:
  // check identity.userId === owner trên URL, KHÔNG dùng ctx.permission (khác
  // /plugin-settings — đó là cấu hình DÙNG CHUNG toàn hệ thống, đây là dữ
  // liệu CỦA CHÍNH caller, cùng kiểu ownership-check như /sessions//projects).
  if (req.method === 'GET' && pathname === '/custom-skills') {
    return sendJson(res, 200, { skills: await ctx.customSkills.listByOwner(identity!.userId) })
  }

  if (req.method === 'POST' && pathname === '/custom-skills') {
    const body = await readJsonBody(req, maxBodyBytes)
    if (typeof body.name !== 'string' || typeof body.description !== 'string' || typeof body.instructions !== 'string' || !Array.isArray(body.triggers)) {
      return sendJson(res, 400, { error: '"name"/"description"/"instructions" (string) và "triggers" (string[]) là bắt buộc' })
    }
    const record = await ctx.customSkills.create(identity!.userId, {
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      triggers: body.triggers,
    })
    return sendJson(res, 201, record)
  }

  const customSkillMatch = pathname.match(/^\/custom-skills\/([^/]+)$/)
  if (req.method === 'PUT' && customSkillMatch) {
    const body = await readJsonBody(req, maxBodyBytes)
    if (typeof body.description !== 'string' || typeof body.instructions !== 'string' || !Array.isArray(body.triggers)) {
      return sendJson(res, 400, { error: '"description"/"instructions" (string) và "triggers" (string[]) là bắt buộc' })
    }
    const record = await ctx.customSkills.update(identity!.userId, customSkillMatch[1], {
      name: customSkillMatch[1],
      description: body.description,
      instructions: body.instructions,
      triggers: body.triggers,
    })
    return sendJson(res, 200, record)
  }
  if (req.method === 'DELETE' && customSkillMatch) {
    await ctx.customSkills.delete(identity!.userId, customSkillMatch[1])
    res.writeHead(204)
    return res.end()
  }

  // Admin moderation — action riêng 'admin:skills:manage', cùng pattern
  // admin:plugins:configure. Không dùng cho CRUD-own ở trên (đó là ownership
  // check thường, không phải RBAC).
  if (req.method === 'GET' && pathname === '/admin/custom-skills') {
    if (!(await ctx.permission.check(identity!.role, 'admin:skills:manage'))) return sendJson(res, 403, { error: 'forbidden' })
    return sendJson(res, 200, { skills: await ctx.customSkills.listAll() })
  }
  const adminCustomSkillMatch = pathname.match(/^\/admin\/custom-skills\/([^/]+)\/([^/]+)$/)
  if (req.method === 'DELETE' && adminCustomSkillMatch) {
    if (!(await ctx.permission.check(identity!.role, 'admin:skills:manage'))) return sendJson(res, 403, { error: 'forbidden' })
    await ctx.customSkills.delete(decodeURIComponent(adminCustomSkillMatch[1]), decodeURIComponent(adminCustomSkillMatch[2]))
    res.writeHead(204)
    return res.end()
  }

  if (req.method === 'POST' && pathname === '/sessions') {
    const body = await readJsonBody(req, maxBodyBytes)
    const session = ctx.sessions.create({
      id: typeof body.id === 'string' ? body.id : undefined,
      driver: typeof body.driver === 'string' ? body.driver : undefined,
      maxSteps: typeof body.maxSteps === 'number' ? body.maxSteps : undefined,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
      ownerId: identity!.userId,
      projectId: undefined,
    })
    return sendJson(res, 201, { id: session.id, driver: session.driver, maxSteps: session.maxSteps })
  }

  const messagesMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/)
  if (req.method === 'POST' && messagesMatch) {
    const session = ctx.sessions.get(messagesMatch[1])
    if (!session) return sendJson(res, 404, { error: `session "${messagesMatch[1]}" not found` })
    if (!canAccessSession(identity!, session)) return sendJson(res, 403, { error: 'forbidden' })
    if (!sessionProjectIsValid(ctx, identity!, session)) return sendJson(res, 403, { error: 'invalid project scope' })

    const body = await readJsonBody(req, maxBodyBytes)
    if (typeof body.message !== 'string' || !body.message) {
      return sendJson(res, 400, { error: '"message" (string) is required' })
    }
    const driver = typeof body.driver === 'string' ? body.driver : session.driver
    const result = await ctx.agent.runTurn(driver, session, {
      message: body.message,
      selectedSkill: typeof body.selectedSkill === 'string' ? body.selectedSkill : undefined,
      metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata as Record<string, unknown>
        : undefined,
      requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
    })
    return sendJson(res, 200, result)
  }

  const sessionRunsMatch = pathname.match(/^\/sessions\/([^/]+)\/runs$/)
  if (req.method === 'GET' && sessionRunsMatch) {
    return sendJson(res, 200, { runs: await ctx.agent.listRuns(sessionRunsMatch[1]) })
  }
  const runCancelMatch = pathname.match(/^\/runs\/([^/]+)\/cancel$/)
  if (req.method === 'POST' && runCancelMatch) {
    const cancelled = await ctx.agent.cancelRun(runCancelMatch[1])
    return cancelled ? sendJson(res, 202, { cancelled: true }) : sendJson(res, 409, { error: 'run is not active' })
  }
  const runMatch = pathname.match(/^\/runs\/([^/]+)$/)
  if (req.method === 'GET' && runMatch) {
    const run = await ctx.agent.getRun(runMatch[1])
    return run ? sendJson(res, 200, run) : sendJson(res, 404, { error: 'run not found' })
  }

  const filesMatch = pathname.match(/^\/sessions\/([^/]+)\/files(?:\/(.+))?$/)
  if (filesMatch) {
    const session = ctx.sessions.get(filesMatch[1])
    if (!session) return sendJson(res, 404, { error: `session "${filesMatch[1]}" not found` })
    // Merge RLM harness (docs/agent-core-rate-limit-and-security-audit.md
    // Finding A1/A2, docs/agent-core-rlm-harness-merge-plan.md mục 3.1):
    // khối /sessions/:id/files merge sạch từ nhánh RLM (không có conflict
    // marker) nhưng KHÔNG có ownership check, khác /messages và /events
    // ngay dưới đây — bất kỳ token hợp lệ nào cũng đọc/ghi/liệt kê được
    // file (dataset thật) của BẤT KỲ session nào nếu biết/đoán đúng id.
    // Thêm đúng cùng check đã áp dụng cho 2 endpoint kia.
    if (!canAccessSession(identity!, session)) return sendJson(res, 403, { error: 'forbidden' })
    if (!sessionProjectIsValid(ctx, identity!, session)) return sendJson(res, 403, { error: 'invalid project scope' })
    return handleWorkspaceFiles(ctx, req, res, session.workspaceId, filesMatch[2] ? decodeURIComponent(filesMatch[2]) : null)
  }

  const eventsMatch = pathname.match(/^\/sessions\/([^/]+)\/events$/)
  if (req.method === 'GET' && eventsMatch) {
    const session = ctx.sessions.get(eventsMatch[1])
    if (!session) return sendJson(res, 404, { error: `session "${eventsMatch[1]}" not found` })
    if (!canAccessSession(identity!, session)) return sendJson(res, 403, { error: 'forbidden' })
    const events = await ctx.storage.readEvents(eventsMatch[1])
    return sendJson(res, 200, { events })
  }

  const eventsV2Match = pathname.match(/^\/v2\/sessions\/([^/]+)\/events$/)
  if (req.method === 'GET' && eventsV2Match) {
    const session = ctx.sessions.get(eventsV2Match[1])
    if (!session) return sendJson(res, 404, { error: `session "${eventsV2Match[1]}" not found` })
    if (!canAccessSession(identity!, session) || !sessionProjectIsValid(ctx, identity!, session)) return sendJson(res, 403, { error: 'forbidden' })
    const afterSeq = Math.max(Number(url.searchParams.get('afterSeq') ?? 0) || 0, 0)
    const limit = Number(url.searchParams.get('limit') ?? 200) || 200
    return sendJson(res, 200, await ctx.storage.readEventPage(eventsV2Match[1], { afterSeq, limit }))
  }

  const jobs = ctx.get('jobs')
  const jobEventsMatch = pathname.match(/^\/jobs\/([^/]+)\/events$/)
  if (req.method === 'GET' && jobEventsMatch) {
    if (!jobs) return sendJson(res, 503, { error: 'job service is not enabled' })
    const job = await jobs.get(jobEventsMatch[1])
    if (!job) return sendJson(res, 404, { error: 'job not found' })
    const page = await ctx.storage.readEventPage(job.sessionId ?? `job:${job.id}`, {
      afterSeq: Number(url.searchParams.get('afterSeq') ?? 0) || 0,
      limit: 100,
    })
    return sendJson(res, 200, { ...page, events: page.events.filter((event) => event.jobId === job.id) })
  }
  const jobCancelMatch = pathname.match(/^\/jobs\/([^/]+)\/cancel$/)
  if (req.method === 'POST' && jobCancelMatch) {
    if (!jobs) return sendJson(res, 503, { error: 'job service is not enabled' })
    return await jobs.cancel(jobCancelMatch[1])
      ? sendJson(res, 202, await jobs.get(jobCancelMatch[1]))
      : sendJson(res, 409, { error: 'job is not cancellable' })
  }
  const jobRetryMatch = pathname.match(/^\/jobs\/([^/]+)\/retry$/)
  if (req.method === 'POST' && jobRetryMatch) {
    if (!jobs) return sendJson(res, 503, { error: 'job service is not enabled' })
    const job = await jobs.retry(jobRetryMatch[1])
    return job ? sendJson(res, 202, job) : sendJson(res, 409, { error: 'job cannot be retried in this process' })
  }
  const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/)
  if (req.method === 'GET' && jobMatch) {
    if (!jobs) return sendJson(res, 503, { error: 'job service is not enabled' })
    const job = await jobs.get(jobMatch[1])
    return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'job not found' })
  }
  const sessionJobsMatch = pathname.match(/^\/sessions\/([^/]+)\/jobs$/)
  if (req.method === 'GET' && sessionJobsMatch) {
    if (!jobs) return sendJson(res, 503, { error: 'job service is not enabled' })
    return sendJson(res, 200, { jobs: await jobs.list({ sessionId: sessionJobsMatch[1] }) })
  }

  const artifacts = ctx.get('artifacts')
  const sessionArtifactsMatch = pathname.match(/^\/sessions\/([^/]+)\/artifacts$/)
  if (req.method === 'GET' && sessionArtifactsMatch) {
    if (!artifacts) return sendJson(res, 503, { error: 'artifact service is not enabled' })
    return sendJson(res, 200, { artifacts: await artifacts.list({
      sessionId: sessionArtifactsMatch[1], kind: url.searchParams.get('kind') ?? undefined,
    }) })
  }
  const artifactMatch = pathname.match(/^\/artifacts\/([^/]+)$/)
  if (req.method === 'GET' && artifactMatch) {
    if (!artifacts) return sendJson(res, 503, { error: 'artifact service is not enabled' })
    const artifact = await artifacts.get(artifactMatch[1])
    return artifact ? sendJson(res, 200, artifact) : sendJson(res, 404, { error: 'artifact not found' })
  }

  if (req.method === 'GET' && pathname === '/pipelines') {
    const registry = ctx.get('pipelines')
    if (!registry) return sendJson(res, 503, { error: 'pipeline service is not enabled' })
    return sendJson(res, 200, {
      pipelines: registry.listPipelines(),
      stages: registry.listStages().map(({ kind, name, description }) => ({ kind, name, description })),
    })
  }
  const pipelineRunMatch = pathname.match(/^\/pipelines\/([^/]+)\/run$/)
  if (req.method === 'POST' && pipelineRunMatch) {
    const runner = ctx.get('pipelineRuns')
    if (!runner) return sendJson(res, 503, { error: 'pipeline service is not enabled' })
    const body = await readJsonBody(req, maxBodyBytes)
    if (typeof body.sessionId !== 'string' || !ctx.sessions.get(body.sessionId)) {
      return sendJson(res, 404, { error: 'session not found' })
    }
    const job = await runner.run(pipelineRunMatch[1], body.sessionId, {
      override: body.override && typeof body.override === 'object' ? body.override as never : undefined,
      config: body.config && typeof body.config === 'object' ? body.config as never : undefined,
    })
    return sendJson(res, 202, job)
  }

  if (req.method === 'POST' && pathname === '/admin/drain') {
    await ctx.agent.drain(Number(url.searchParams.get('timeoutMs') ?? 10_000) || 10_000)
    return sendJson(res, 200, { drained: true })
  }

  sendJson(res, 404, { error: 'not found' })
}
