// bundles/providers/auth-apikey — provider cho seam ctx.auth (production hardening).
//
// So khớp bằng constant-time compare (crypto.timingSafeEqual) — so sánh
// string thường (`===`) rò rỉ thời gian theo độ dài phần khớp, đủ để dò key
// qua timing attack trên 1 service nội bộ lặp lại nhiều lần. Chi phí thêm
// gần như 0, không lý do gì để không làm đúng.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { type AuthTicket, AuthService } from '../../../seams/auth.ts'

export namespace AuthApiKey {
  export interface Config {
    keys: string[]
  }
}

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // Độ dài khác nhau thì chắc chắn không khớp — nhưng vẫn phải chạy
  // timingSafeEqual trên buffer CÙNG độ dài để không rò rỉ độ dài key thật
  // qua early-return timing.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export class AuthApiKey extends AuthService {
  private tickets = new Map<string, number>()
  constructor(ctx: Context, public config: AuthApiKey.Config) {
    super(ctx)
    if (!config.keys?.length) {
      throw new Error('auth-apikey: config.keys rỗng — không có key nào hợp lệ, mọi request sẽ bị từ chối')
    }
  }

  verify(token: string | undefined) {
    if (!token) return false
    return this.config.keys.some((key) => safeEqual(token, key))
  }

  issueTicket(ttlMs = 60_000): AuthTicket {
    const ticket = randomBytes(32).toString('hex')
    const expiresAtMs = Date.now() + Math.min(Math.max(ttlMs, 1_000), 300_000)
    this.tickets.set(ticket, expiresAtMs)
    const now = Date.now()
    for (const [value, expiry] of this.tickets) if (expiry < now) this.tickets.delete(value)
    return { ticket, expiresAtMs }
  }

  verifyTicket(ticket: string | undefined) {
    if (!ticket) return false
    const expiresAt = this.tickets.get(ticket)
    this.tickets.delete(ticket)
    return expiresAt !== undefined && Date.now() <= expiresAt
  }
}

export const apply = async (ctx: Context, config: AuthApiKey.Config) => {
  await ctx.plugin(AuthApiKey, config)
}
