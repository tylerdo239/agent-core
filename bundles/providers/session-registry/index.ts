// bundles/session-registry — provider cho seam ctx.sessions (Phase 6).
//
// In-memory Map — đủ cho 1 process. Nếu cần chia sẻ session qua nhiều
// process/instance (scale-out), đây là chỗ cần thay bằng provider khác
// (Redis...) sau này — seam đã tách sẵn, không cần sửa REST/WS/gRPC.
//
// Phase 8.1 (coding rule A14): Map trước đây giữ session VĨNH VIỄN — leak RAM
// thật trên deployment chạy dài hạn (session bị bỏ dở không bao giờ mất).
// Thêm TTL TRƯỢT THEO HOẠT ĐỘNG (không phải TTL cứng từ lúc tạo): mỗi lần
// `get()` cập nhật `lastActiveAt` — session đang chat liên tục không bị sweep
// giữa chừng, chỉ session thật sự bị bỏ quên (không ai `get()` trong `ttlMs`)
// mới bị dọn.
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { CreateSessionOptions, SessionRegistryService } from '../../../seams/sessions.ts'
import { Session } from '../../../seams/loop.ts'

const DEFAULT_TTL_MS = 30 * 60_000
const DEFAULT_SWEEP_INTERVAL_MS = 60_000

export namespace SessionRegistry {
  export interface Config {
    ttlMs?: number
    sweepIntervalMs?: number
  }
}

interface Entry {
  session: Session
  lastActiveAt: number
}

export class SessionRegistry extends SessionRegistryService {
  private entries = new Map<string, Entry>()
  private ttlMs: number

  constructor(ctx: Context, public config: SessionRegistry.Config = {}) {
    super(ctx)
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS
  }

  // Sweep sống trong CHÍNH class này (không phải ở apply() ngoài) — đọc
  // `ctx.sessions` từ apply() của chính bundle cung cấp seam đó throw "cannot
  // get property without inject" (đã verify thực nghiệm), và tự inject
  // ['sessions'] cho apply() của chính mình là deadlock (seam chưa tồn tại
  // tới khi apply() này chạy xong). Cùng pattern [Service.init]() trả về
  // disposer như state-sqlite (coding rule A4).
  [Service.init]() {
    const sweepIntervalMs = this.config.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
    const interval = setInterval(() => this.sweepExpired(Date.now()), sweepIntervalMs)
    return () => clearInterval(interval)
  }

  create(opts: CreateSessionOptions = {}) {
    const id = opts.id ?? randomUUID()
    if (this.entries.has(id)) {
      throw new Error(`session "${id}" already exists`)
    }
    const session = new Session(id, opts.maxSteps ?? 8, opts.systemPrompt, opts.driver ?? 'default', opts.maxHistoryMessages, opts.ownerId)
    this.entries.set(id, { session, lastActiveAt: Date.now() })
    this.ctx.logger('session-registry').info('created session "%s" (driver=%s)', id, session.driver)
    return session
  }

  get(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    entry.lastActiveAt = Date.now()
    return entry.session
  }

  list() {
    return [...this.entries.values()].map((e) => e.session)
  }

  remove(id: string) {
    return this.entries.delete(id)
  }

  /** Gọi từ sweep định kỳ (xem `apply`) — không phải API public của seam. */
  sweepExpired(now: number) {
    for (const [id, entry] of this.entries) {
      if (now - entry.lastActiveAt > this.ttlMs) {
        this.entries.delete(id)
        this.ctx.logger('session-registry').info('sweep: removed expired session "%s" (idle > %dms)', id, this.ttlMs)
      }
    }
  }
}

export const apply = async (ctx: Context, config: SessionRegistry.Config = {}) => {
  await ctx.plugin(SessionRegistry, config)
}
