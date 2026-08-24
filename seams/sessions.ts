// seams/sessions.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/session-registry.
//
// Phase 6: REST là stateless-per-request, WS/gRPC là long-lived connection —
// cả 3 adapter cần 1 nơi DÙNG CHUNG để tạo/tra Session theo id. Adapter nào
// tự giữ session riêng = 2 client qua 2 giao thức khác nhau không thấy cùng
// 1 cuộc hội thoại — đây là lý do seam này tồn tại, không phải tiện ích.
import { Context, Service } from '@deepseek-ai/cordis'
import { Session } from './loop.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: SessionRegistryService
  }
  interface Events {
    'session/created'(session: Session): void
    'session/disposed'(event: { id: string; reason: 'removed' | 'expired' | 'provider_disposed' }): void
  }
}

export interface CreateSessionOptions {
  id?: string
  driver?: string
  maxSteps?: number
  systemPrompt?: string
  /** Phase 8.2 — xem seams/loop.ts (Session.maxHistoryMessages). */
  maxHistoryMessages?: number
  /** Module auth — xem seams/loop.ts (Session.ownerId). Adapter LUÔN truyền
   * field này từ identity đã verify() được, không phải từ client. */
  ownerId?: string
}

export abstract class SessionRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  abstract create(opts?: CreateSessionOptions): Session
  /** Cập nhật thời điểm hoạt động gần nhất của session (Phase 8.1 — TTL trượt theo hoạt động, không phải TTL cứng từ lúc tạo). */
  abstract get(id: string): Session | undefined
  abstract list(): Session[]
  /** Xoá 1 session ngay lập tức (không đợi sweep). Trả về false nếu id không tồn tại. */
  abstract remove(id: string): boolean
}
