// bundles/api-rest — Phase 6.1: REST adapter mỏng qua ctx.sessions/ctx.agent/ctx.storage.
//
// Dùng thẳng `node:http` — không thêm framework (coding rule A6, chỉ endpoint
// ít, không cần routing phức tạp). `apply` tự thân là async, mở server
// rồi return disposer trực tiếp (coding rule A13) — cùng kỷ luật lifecycle
// như mọi provider khác trong repo: mount → unmount phải đóng cổng sạch, có
// test xác nhận (giống pattern Phase 2 cho SQLite).
//
// Bundle này KHÔNG đăng ký vào registry nào khác (khác loop driver) — chính
// nó sở hữu server của nó, nên rule A12 không áp dụng: handler route được
// phép đóng gói `ctx` từ `apply()` của chính bundle này, vì fiber sở hữu
// handler và fiber sở hữu server luôn là MỘT, dispose cùng lúc.
//
// Production hardening: MỌI request (trừ /health, /ready, /auth/signup,
// /auth/login) phải có `Authorization: Bearer <token>` hợp lệ qua
// ctx.auth.verify() — coding rule B1 (chạm resource phải tự check, không
// giả định caller đã check hộ). Body giới hạn kích thước — request lớn hơn
// bị từ chối trước khi đọc hết, tránh 1 request ăn hết RAM process.
//
// Module auth (nhiều người dùng thật): verify() giờ trả về AuthIdentity
// (không còn boolean thuần) — mọi session tạo mới gắn `ownerId` từ CHÍNH
// identity đã verify (KHÔNG BAO GIỜ từ field client tự khai trong body).
// GET /sessions/:id/events và POST /sessions/:id/messages đều check thêm
// quyền sở hữu (canAccessSession) SAU khi xác nhận session tồn tại — thiếu
// bước này thì bất kỳ token hợp lệ nào cũng đọc/ghi được session của người
// khác, chỉ cần biết/đoán đúng id (gap thật, không phải giả thuyết).
//
// CORS: bật cho MỌI request — cần thiết ngay khi có browser client
// (bundles/adapters/web-ui chạy ở port khác = origin khác theo trình duyệt),
// độc lập với việc mạng có internet-facing hay không. An toàn để mặc định
// `*` vì auth ở đây dùng Bearer token (browser không tự đính kèm như
// cookie) — không có rủi ro CSRF kiểu cookie-based, khác hẳn hệ thống dùng
// session cookie.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/sessions.ts'
import '../../../seams/agent.ts'
import '../../../seams/storage.ts'
import '../../../seams/permission.ts'
import '../../../seams/auth.ts'
import { AuthIdentity } from '../../../seams/auth.ts'
import { Session } from '../../../seams/loop.ts'
import '../../../seams/skill.ts'
import '../../../seams/workspace.ts'

export namespace ApiRest {
  export interface Config {
    /** 0 = để OS tự chọn cổng trống (dùng trong test); mặc định 8787 cho chạy tay. */
    port?: number
    /** Giới hạn body request (byte) — mặc định 1 MiB. */
    maxBodyBytes?: number
    /** Access-Control-Allow-Origin — mặc định "*" (xem ghi chú CORS ở đầu file). */
    corsOrigin?: string
  }
}

export const inject = ['sessions', 'agent', 'storage', 'auth', 'permission', 'skills', 'workspace', 'pluginInventory']

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 // 1 MiB
const FILE_MAX_BODY_BYTES = 70 * 1024 * 1024 // 70 MiB for uploads

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

const PUBLIC_PATHS = new Set(['/health', '/ready', '/auth/signup', '/auth/login'])

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

  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', corsOrigin)
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
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

  await new Promise<void>((resolve) => server.listen(config.port ?? 8787, resolve))
  const address = server.address()
  if (address && typeof address === 'object') config.port = address.port
  ctx.logger('api-rest').info('listening on :%d', config.port)

  return () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
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
    return sendJson(res, 200, { sessions: mine.map((s) => ({ id: s.id, driver: s.driver, maxSteps: s.maxSteps, createdAt: s.createdAt })) })
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

  if (req.method === 'GET' && pathname === '/skills') {
    const skills = ctx.skills
      .list({ userInvocableOnly: true, topLevelOnly: true })
      .map(({ name, description }) => ({ name, description }))
    return sendJson(res, 200, { skills })
  }

  if (req.method === 'POST' && pathname === '/sessions') {
    const body = await readJsonBody(req, maxBodyBytes)
    const session = ctx.sessions.create({
      id: typeof body.id === 'string' ? body.id : undefined,
      driver: typeof body.driver === 'string' ? body.driver : undefined,
      maxSteps: typeof body.maxSteps === 'number' ? body.maxSteps : undefined,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
      ownerId: identity!.userId,
    })
    return sendJson(res, 201, { id: session.id, driver: session.driver, maxSteps: session.maxSteps })
  }

  const messagesMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/)
  if (req.method === 'POST' && messagesMatch) {
    const session = ctx.sessions.get(messagesMatch[1])
    if (!session) return sendJson(res, 404, { error: `session "${messagesMatch[1]}" not found` })
    if (!canAccessSession(identity!, session)) return sendJson(res, 403, { error: 'forbidden' })

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
    })
    return sendJson(res, 200, result)
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
    const subPath = filesMatch[2] ? decodeURIComponent(filesMatch[2]) : null

    if (req.method === 'GET' && !subPath) {
      const files = await ctx.workspace.listFiles(filesMatch[1])
      const snapshot = await ctx.workspace.inspect(filesMatch[1])
      return sendJson(res, 200, { files, datasets: snapshot.resources?.datasets ?? [], artifacts: snapshot.resources?.artifacts ?? [] })
    }

    if (req.method === 'GET' && subPath) {
      try {
        const buf = await ctx.workspace.readFile(filesMatch[1], subPath)
        const ext = subPath.split('.').pop()?.toLowerCase() ?? ''
        const mime: Record<string, string> = { csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', txt: 'text/plain', html: 'text/html', png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' }
        res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream', 'content-disposition': `attachment; filename="${encodeURIComponent(subPath.split('/').pop()!)}"` })
        return res.end(buf)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        return sendJson(res, 404, { error: msg })
      }
    }

    if (req.method === 'POST' && !subPath) {
      let filename = ''
      let buf: Buffer
      if ((req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() === 'application/octet-stream') {
        const rawName = Array.isArray(req.headers['x-file-name']) ? req.headers['x-file-name'][0] : req.headers['x-file-name']
        try { filename = decodeURIComponent(String(rawName ?? '')) } catch { filename = '' }
        buf = await readBody(req, FILE_MAX_BODY_BYTES)
      } else {
        // Backward-compatible JSON path for non-browser clients. Base64 adds
        // roughly 4/3 overhead, so the request limit must be larger than the
        // decoded file limit.
        const body = await readJsonBody(req, Math.ceil(FILE_MAX_BODY_BYTES * 4 / 3) + 1024)
        filename = typeof body.filename === 'string' ? body.filename : ''
        const content = typeof body.content === 'string' ? body.content : ''
        if (!content) return sendJson(res, 400, { error: 'filename and content are required' })
        buf = body.encoding === 'utf8' ? Buffer.from(content, 'utf8') : Buffer.from(content, 'base64')
      }
      if (!filename) return sendJson(res, 400, { error: 'filename is required' })
      if (buf.byteLength > FILE_MAX_BODY_BYTES) return sendJson(res, 413, { error: 'file too large' })
      const result = await ctx.workspace.writeFile(filesMatch[1], filename, buf)
      return sendJson(res, 201, result)
    }
  }

  const eventsMatch = pathname.match(/^\/sessions\/([^/]+)\/events$/)
  if (req.method === 'GET' && eventsMatch) {
    const session = ctx.sessions.get(eventsMatch[1])
    if (!session) return sendJson(res, 404, { error: `session "${eventsMatch[1]}" not found` })
    if (!canAccessSession(identity!, session)) return sendJson(res, 403, { error: 'forbidden' })
    const events = await ctx.storage.readEvents(eventsMatch[1])
    return sendJson(res, 200, { events })
  }

  sendJson(res, 404, { error: 'not found' })
}
