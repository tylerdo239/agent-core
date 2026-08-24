// seams/auth.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/providers/auth-users (Postgres — thay thế hoàn
// toàn auth-apikey cũ, breaking change có chủ đích: verify() từ boolean
// đồng bộ đổi sang trả về danh tính người dùng, bất đồng bộ).
//
// Production hardening: REST/WS/gRPC (bundles/adapters/*) đều inject seam
// này và tự check trước khi xử lý request — không có request nào chạm vào
// ctx.sessions/ctx.agent mà chưa qua verify() (coding rule B1 áp dụng đúng
// tinh thần: bất kỳ thứ gì chạm resource phải tự check permission/auth,
// không giả định caller đã check hộ).
//
// Module auth (nhiều người dùng thật): trước đây `verify()` chỉ trả boolean
// — không có khái niệm "ai" đã xác thực, nên session/permission không thể
// gắn chủ sở hữu. `verify()` giờ trả về AuthIdentity (userId/username/role)
// hoặc undefined — đủ để adapter gắn `ownerId` vào session lúc tạo, và để
// route admin-only tự check role qua ctx.permission (seam đó KHÔNG đổi, xem
// seams/permission.ts — `check(actor, action)` đã đủ tổng quát).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    auth: AuthService
  }
}

export type Role = 'admin' | 'user'

export interface AuthIdentity {
  userId: string
  username: string
  role: Role
}

export interface UserRecord {
  id: string
  username: string
  role: Role
  active: boolean
  createdAt: number
}

export interface AuthResult {
  user: UserRecord
  token: string
}

export abstract class AuthService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'auth')
  }

  /** `token` là giá trị đã tách khỏi tiền tố "Bearer " (hoặc tương đương) —
   * verify() không tự parse header. Bất đồng bộ (provider Postgres query qua
   * `pg`, không đồng bộ như better-sqlite3 trước đây). */
  abstract verify(token: string | undefined): Promise<AuthIdentity | undefined>

  /** User ĐẦU TIÊN trong toàn hệ thống luôn thành 'admin' (bootstrap — tự
   * đăng ký nghĩa là không có admin nào tồn tại sẵn lúc mới cài đặt). Mọi
   * signup sau đó mặc định 'user'. Username trùng -> throw. */
  abstract signup(username: string, password: string): Promise<AuthResult>

  /** Sai username/password hoặc tài khoản bị deactivate -> throw cùng 1
   * thông điệp chung (không tiết lộ username nào tồn tại). */
  abstract login(username: string, password: string): Promise<AuthResult>

  /** Thu hồi ĐÚNG 1 token (phiên hiện tại) — không phải mọi token của user. */
  abstract logout(token: string): Promise<void>

  abstract listUsers(): Promise<UserRecord[]>
  /** role==='user' khi userId đang là admin CUỐI CÙNG -> throw (không được
   * để hệ thống mất quyền admin vĩnh viễn). */
  abstract setRole(userId: string, role: Role): Promise<void>
  /** active=false: vô hiệu hoá NGAY LẬP TỨC toàn bộ token hiện có của user đó
   * (logout cưỡng bức). Cùng ràng buộc "không tự khoá admin cuối" như setRole. */
  abstract setActive(userId: string, active: boolean): Promise<void>
  /** Cùng ràng buộc "không xoá admin cuối". Xoá cứng. */
  abstract deleteUser(userId: string): Promise<void>
}
