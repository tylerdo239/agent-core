// seams/auth.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/providers/auth-apikey.
//
// Production hardening: REST/WS/gRPC (bundles/adapters/*) đều inject seam
// này và tự check trước khi xử lý request — không có request nào chạm vào
// ctx.sessions/ctx.agent mà chưa qua verify() (coding rule B1 áp dụng đúng
// tinh thần: bất kỳ thứ gì chạm resource phải tự check permission/auth,
// không giả định caller đã check hộ).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    auth: AuthService
  }
}

export interface AuthTicket { ticket: string; expiresAtMs: number }

export abstract class AuthService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'auth')
  }

  /** `token` là giá trị đã tách khỏi tiền tố "Bearer " (hoặc tương đương) — verify() không tự parse header. */
  abstract verify(token: string | undefined): boolean
  issueTicket?(ttlMs?: number): AuthTicket
  verifyTicket?(ticket: string | undefined): boolean
}
