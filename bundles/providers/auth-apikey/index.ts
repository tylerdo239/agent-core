// bundles/providers/auth-apikey — provider cho seam ctx.auth (production hardening).
//
// So khớp bằng constant-time compare (crypto.timingSafeEqual) — so sánh
// string thường (`===`) rò rỉ thời gian theo độ dài phần khớp, đủ để dò key
// qua timing attack trên 1 service nội bộ lặp lại nhiều lần. Chi phí thêm
// gần như 0, không lý do gì để không làm đúng.
import { timingSafeEqual } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { AuthService } from '../../../seams/auth.ts'

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
}

export const apply = async (ctx: Context, config: AuthApiKey.Config) => {
  await ctx.plugin(AuthApiKey, config)
}
