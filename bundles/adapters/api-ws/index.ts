// bundles/api-ws — Phase 6.2: WebSocket streaming qua ctx.sessions/ctx.agent, nghe ctx.on('agent/step').
//
// Cùng nguyên tắc lifecycle như bundles/api-rest (coding rule A13): `apply`
// là async, return disposer trực tiếp. Cùng nguyên tắc không-đăng-ký-vào-
// registry-khác như api-rest — bundle này sở hữu server của chính nó, rule
// A12 không áp dụng.
//
// Giao thức JSON 2 chiều (xem docs/agent-core-cordis-build-plan.md Phase 6.2):
//   Client -> Server: { type: "create_session", driver?, maxSteps?, systemPrompt? }
//   Server -> Client: { type: "session_created", id, driver }
//   Client -> Server: { type: "send_message", sessionId, message, driver? }
//   Server -> Client: { type: "step", sessionId, step }   (0..N lần)
//   Server -> Client: { type: "done", sessionId, result }  (1 lần, cuối turn)
//   Server -> Client: { type: "error", message }
//
// Production hardening: auth check ở NGAY LÚC HANDSHAKE (`verifyClient`) —
// từ chối bằng HTTP 401 trước khi nâng cấp lên WebSocket, không phải
// accept-connection-rồi-đóng. `maxPayload` giới hạn kích thước 1 message,
// tránh 1 client gửi frame khổng lồ ăn RAM.
//
// Key lấy từ 2 nguồn (thử header trước, query string sau) — KHÔNG phải 1
// trong 2 là đủ cho mọi client thật: `new WebSocket(url)` theo Web spec
// KHÔNG có tham số set custom header (khác client Node package `ws` dùng
// trong test, có hỗ trợ `{ headers }`). Browser thật (bundles/adapters/web-ui)
// PHẢI dùng query string (`?key=...`); giữ header cho client Node hiện có.
import { WebSocketServer, type WebSocket } from 'ws'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/sessions.ts'
import '../../../seams/agent.ts'
import '../../../seams/auth.ts'
import { LoopStep } from '../../../seams/loop.ts'

export namespace ApiWs {
  export interface Config {
    /** 0 = để OS tự chọn cổng trống (dùng trong test); mặc định 8788 cho chạy tay. */
    port?: number
    /** Giới hạn 1 message (byte) — mặc định 1 MiB. */
    maxPayloadBytes?: number
  }
}

export const inject = ['sessions', 'agent', 'auth']

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024 // 1 MiB

type ClientMessage =
  | { type: 'create_session'; driver?: string; maxSteps?: number; systemPrompt?: string }
  | { type: 'send_message'; sessionId: string; message: string; driver?: string; selectedSkill?: string; metadata?: Record<string, unknown>; requestId?: string }
  | { type: 'cancel_run'; runId: string }

function send(socket: WebSocket, payload: unknown) {
  socket.send(JSON.stringify(payload))
}

function extractToken(req: import('node:http').IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length)
  const url = new URL(req.url ?? '/', 'http://localhost')
  return url.searchParams.get('key') ?? undefined
}

function extractTicket(req: import('node:http').IncomingMessage) {
  return new URL(req.url ?? '/', 'http://localhost').searchParams.get('ticket') ?? undefined
}

export const apply = async (ctx: Context, config: ApiWs.Config = {}) => {
  const wss = new WebSocketServer({
    port: config.port ?? 8788,
    maxPayload: config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    verifyClient: (info, callback) => {
      const token = extractToken(info.req)
      if (ctx.auth.verifyTicket?.(extractTicket(info.req)) || ctx.auth.verify(token)) return callback(true)
      callback(false, 401, 'unauthorized')
    },
  })

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve)
    wss.once('error', reject)
  })
  const address = wss.address()
  if (address && typeof address === 'object') config.port = address.port
  ctx.logger('api-ws').info('listening on :%d', config.port)

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      handleMessage(ctx, socket, raw.toString()).catch((err: any) => {
        ctx.logger('api-ws').error(err)
        send(socket, { type: 'error', message: err?.message ?? 'internal error' })
      })
    })
  })

  return () =>
    new Promise<void>((resolve, reject) => {
      wss.close((err) => (err ? reject(err) : resolve()))
    })
}

async function handleMessage(ctx: Context, socket: WebSocket, raw: string) {
  let msg: ClientMessage
  try {
    msg = JSON.parse(raw)
  } catch {
    return send(socket, { type: 'error', message: 'invalid JSON' })
  }

  if (msg.type === 'create_session') {
    const session = ctx.sessions.create({
      driver: msg.driver,
      maxSteps: msg.maxSteps,
      systemPrompt: msg.systemPrompt,
    })
    return send(socket, { type: 'session_created', id: session.id, driver: session.driver })
  }

  if (msg.type === 'send_message') {
    const session = ctx.sessions.get(msg.sessionId)
    if (!session) return send(socket, { type: 'error', message: `session "${msg.sessionId}" not found` })

    // Nghe live event CHỈ cho đúng sessionId này, gỡ ngay khi turn xong —
    // không leak listener qua các turn/socket khác.
    const unsub = ctx.on('agent/step', (event: { sessionId: string; step: LoopStep }) => {
      if (event.sessionId !== msg.sessionId) return
      send(socket, { type: 'step', sessionId: event.sessionId, step: event.step })
    })

    try {
      const driver = msg.driver ?? session.driver
      const result = await ctx.agent.runTurn(driver, session, {
        message: msg.message,
        selectedSkill: msg.selectedSkill,
        metadata: msg.metadata,
        requestId: msg.requestId,
      })
      send(socket, { type: 'done', sessionId: session.id, result })
    } finally {
      unsub()
    }
    return
  }

  if (msg.type === 'cancel_run') {
    const cancelled = await ctx.agent.cancelRun(msg.runId)
    return send(socket, { type: 'run_cancelled', runId: msg.runId, cancelled })
  }

  send(socket, { type: 'error', message: `unknown message type` })
}
