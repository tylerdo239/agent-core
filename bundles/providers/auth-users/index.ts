// bundles/providers/auth-users — provider cho seam ctx.auth (module đăng ký/
// đăng nhập nhiều người dùng thật). Thay thế hoàn toàn auth-apikey cũ.
//
// Dùng Postgres (package `pg`) thay vì SQLite — quyết định có chủ đích:
// user chọn Postgres cho module này cụ thể (không phải để "giống dsh", dsh
// không có khái niệm multi-user auth — xem docs), ctx.storage (event log
// hội thoại) vẫn giữ nguyên SQLite, không đụng tới. `pg` thuần JS, không cần
// compile native (khác better-sqlite3 cần python3/make/g++) — không lặp lại
// gánh nặng Docker build đã gặp trước đây.
//
// Hash password: scrypt (node:crypto built-in, KHÔNG thêm dependency ngoài
// `pg`) — salt ngẫu nhiên riêng từng user, so khớp bằng timingSafeEqual
// (cùng kỷ luật constant-time đã áp dụng ở auth-apikey cũ). Token: chuỗi
// ngẫu nhiên 256-bit, lưu THEO HASH sha256 (không lưu token thô — rò rỉ DB
// không lộ được token dùng ngay).
import { randomUUID, randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import pg from 'pg'
import { AuthService, AuthIdentity, AuthResult, Role, UserRecord } from '../../../seams/auth.ts'

const { Pool } = pg

const SCRYPT_KEY_LENGTH = 64
const CONNECT_RETRY_ATTEMPTS = 5
const CONNECT_RETRY_BASE_DELAY_MS = 500

export namespace AuthUsers {
  export interface Config {
    connectionString: string
  }
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class AuthUsers extends AuthService {
  private pool!: pg.Pool

  constructor(ctx: Context, public config: AuthUsers.Config) {
    super(ctx)
  }

  async [Service.init]() {
    this.pool = new Pool({ connectionString: this.config.connectionString })

    // Boot resilience: docker-compose `depends_on: condition: service_healthy`
    // xử lý trường hợp thường gặp, nhưng `pg_isready` báo healthy và Postgres
    // sẵn sàng nhận connection thật vẫn có thể lệch nhịp hẹp — retry vài lần
    // trước khi coi là lỗi thật (cùng tinh thần retry-with-backoff đã có ở
    // llm-qwen cho lỗi mạng transient).
    for (let attempt = 1; ; attempt++) {
      try {
        await this.pool.query('SELECT 1')
        break
      } catch (err) {
        if (attempt >= CONNECT_RETRY_ATTEMPTS) throw err
        this.ctx.logger('auth-users').warn('kết nối Postgres thất bại (lần %d/%d), thử lại...', attempt, CONNECT_RETRY_ATTEMPTS)
        await sleep(CONNECT_RETRY_BASE_DELAY_MS * attempt)
      }
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens (user_id)`)
    this.ctx.logger('auth-users').info('connected (Postgres)')

    return async () => {
      await this.pool.end()
      this.ctx.logger('auth-users').info('closed cleanly')
    }
  }

  private toRecord(row: any): UserRecord {
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      active: row.active,
      createdAt: new Date(row.created_at).getTime(),
    }
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private async issueToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex')
    await this.pool.query('INSERT INTO auth_tokens (token_hash, user_id) VALUES ($1, $2)', [this.tokenHash(token), userId])
    return token
  }

  /** Chặn hạ quyền/khoá/xoá admin CUỐI CÙNG còn active — không được để hệ
   * thống mất hết quyền admin vĩnh viễn. */
  private async assertNotLastAdmin(userId: string) {
    const { rows } = await this.pool.query('SELECT role FROM users WHERE id = $1', [userId])
    if (rows[0]?.role !== 'admin') return
    const { rows: countRows } = await this.pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active = true`)
    if (countRows[0].n <= 1) throw httpError('không thể xoá/hạ quyền/khoá admin cuối cùng của hệ thống', 409)
  }

  async signup(username: string, password: string): Promise<AuthResult> {
    username = username.trim()
    if (!username || password.length < 8) {
      throw httpError('username không hợp lệ hoặc mật khẩu quá ngắn (>=8 ký tự)', 400)
    }
    const { rows: existing } = await this.pool.query('SELECT id FROM users WHERE username = $1', [username])
    if (existing.length) throw httpError('username đã tồn tại', 409)

    const { rows: countRows } = await this.pool.query('SELECT count(*)::int AS n FROM users')
    const role: Role = countRows[0].n === 0 ? 'admin' : 'user' // bootstrap: user đầu tiên = admin

    const id = randomUUID()
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex')
    const { rows } = await this.pool.query(
      'INSERT INTO users (id, username, password_salt, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, username, salt, hash, role],
    )
    this.ctx.logger('auth-users').info('signup: "%s" (role=%s)%s', username, role, role === 'admin' ? ' [bootstrap admin]' : '')
    return { user: this.toRecord(rows[0]), token: await this.issueToken(id) }
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE username = $1', [username.trim()])
    const row = rows[0]
    if (!row || !row.active) throw httpError('sai tên đăng nhập hoặc mật khẩu', 401)
    const candidate = scryptSync(password, row.password_salt, SCRYPT_KEY_LENGTH)
    const stored = Buffer.from(row.password_hash, 'hex')
    if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
      throw httpError('sai tên đăng nhập hoặc mật khẩu', 401)
    }
    return { user: this.toRecord(row), token: await this.issueToken(row.id) }
  }

  async verify(token: string | undefined): Promise<AuthIdentity | undefined> {
    if (!token) return undefined
    const { rows } = await this.pool.query(
      `SELECT u.id AS user_id, u.username, u.role, u.active FROM auth_tokens t
       JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`,
      [this.tokenHash(token)],
    )
    const row = rows[0]
    if (!row || !row.active) return undefined
    return { userId: row.user_id, username: row.username, role: row.role }
  }

  async logout(token: string) {
    await this.pool.query('DELETE FROM auth_tokens WHERE token_hash = $1', [this.tokenHash(token)])
  }

  async listUsers(): Promise<UserRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM users ORDER BY created_at ASC')
    return rows.map((r) => this.toRecord(r))
  }

  async setRole(userId: string, role: Role) {
    if (role === 'user') await this.assertNotLastAdmin(userId)
    const result = await this.pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId])
    if (result.rowCount === 0) throw httpError(`user "${userId}" không tồn tại`, 404)
  }

  async setActive(userId: string, active: boolean) {
    if (!active) await this.assertNotLastAdmin(userId)
    const result = await this.pool.query('UPDATE users SET active = $1 WHERE id = $2', [active, userId])
    if (result.rowCount === 0) throw httpError(`user "${userId}" không tồn tại`, 404)
    // deactivate = logout cưỡng bức ngay — không để token cũ còn dùng được.
    if (!active) await this.pool.query('DELETE FROM auth_tokens WHERE user_id = $1', [userId])
  }

  async deleteUser(userId: string) {
    await this.assertNotLastAdmin(userId)
    // ON DELETE CASCADE trên auth_tokens.user_id tự dọn token — chỉ cần xoá
    // đúng 1 bảng users.
    const result = await this.pool.query('DELETE FROM users WHERE id = $1', [userId])
    if (result.rowCount === 0) throw httpError(`user "${userId}" không tồn tại`, 404)
  }
}

export const apply = async (ctx: Context, config: AuthUsers.Config) => {
  await ctx.plugin(AuthUsers, config)
}
