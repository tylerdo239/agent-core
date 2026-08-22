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

export const inject = ['sessions', 'agent', 'storage', 'auth', 'permission']

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 // 1 MiB

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > maxBytes) {
      throw Object.assign(new Error(`request body exceeds ${maxBytes} bytes`), { status: 413 })
    }
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
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
    res.setHeader('access-control-allow-headers', 'content-type, authorization')
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
    const result = await ctx.agent.runTurn(driver, session, body.message)
    return sendJson(res, 200, result)
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
