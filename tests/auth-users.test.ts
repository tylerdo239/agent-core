// Module auth (nhiều người dùng thật): test THẬT chống lại Postgres thật
// (không mock `pg` — password hashing/"last admin guard" là đúng loại logic
// trông đúng nhưng có thể sai âm thầm nếu chỉ test qua mock). Cần
// DATABASE_URL trỏ tới 1 Postgres thật đang chạy — xem README cho cách khởi
// động (`docker compose up postgres -d` hoặc container test riêng).
//
// Mỗi test tự tạo 1 schema Postgres RIÊNG (CREATE SCHEMA + search_path) rồi
// xoá lúc cleanup — cô lập hoàn toàn giữa các test, không phải lo dọn từng
// bảng thủ công hay lo test chạy song song đụng username trùng nhau.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import pg from 'pg'
import * as authUsers from '../bundles/providers/auth-users/index.ts'

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:test@127.0.0.1:5433/agent_core_test'

let cleanup: (() => Promise<unknown>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

async function bootWithFreshSchema() {
  const schema = `test_${randomUUID().replace(/-/g, '')}`
  const admin = new pg.Pool({ connectionString: BASE_URL })
  await admin.query(`CREATE SCHEMA "${schema}"`)

  const url = new URL(BASE_URL)
  url.searchParams.set('options', `-c search_path=${schema}`)

  const root = new Context()
  const fiber = root.plugin(authUsers, { connectionString: url.toString() })
  await new Promise((r) => setTimeout(r, 10))
  await fiber.await()

  cleanup = async () => {
    await fiber.dispose()
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.end()
  }
  return { root, fiber }
}

describe('bundles/providers/auth-users (Postgres thật)', () => {
  it('signup user đầu tiên -> role admin; user thứ 2 -> role user', async () => {
    const { root } = await bootWithFreshSchema()

    const first = await root.auth.signup('alice', 'correcthorse123')
    expect(first.user.role).toBe('admin')
    expect(first.token).toMatch(/^[0-9a-f]{64}$/)

    const second = await root.auth.signup('bob', 'correcthorse123')
    expect(second.user.role).toBe('user')
  })

  it('signup username trùng -> throw 409; password ngắn -> throw 400', async () => {
    const { root } = await bootWithFreshSchema()
    await root.auth.signup('alice', 'correcthorse123')

    await expect(root.auth.signup('alice', 'anotherpass1')).rejects.toMatchObject({ status: 409 })
    await expect(root.auth.signup('carol', 'short')).rejects.toMatchObject({ status: 400 })
  })

  it('login đúng mật khẩu -> token mới; sai mật khẩu/username -> 401 (không lộ username nào tồn tại)', async () => {
    const { root } = await bootWithFreshSchema()
    await root.auth.signup('alice', 'correcthorse123')

    const result = await root.auth.login('alice', 'correcthorse123')
    expect(result.user.username).toBe('alice')

    await expect(root.auth.login('alice', 'sai-mat-khau')).rejects.toMatchObject({ status: 401 })
    await expect(root.auth.login('khong-ton-tai', 'bat-ky-gi123')).rejects.toMatchObject({ status: 401 })
  })

  it('verify(token) đúng -> trả identity; token sai/rỗng -> undefined', async () => {
    const { root } = await bootWithFreshSchema()
    const { token, user } = await root.auth.signup('alice', 'correcthorse123')

    const identity = await root.auth.verify(token)
    expect(identity).toEqual({ userId: user.id, username: 'alice', role: 'admin' })

    expect(await root.auth.verify('token-sai')).toBeUndefined()
    expect(await root.auth.verify(undefined)).toBeUndefined()
  })

  it('logout thu hồi ĐÚNG 1 token — token khác của cùng user vẫn còn hiệu lực', async () => {
    const { root } = await bootWithFreshSchema()
    const { token: tokenA } = await root.auth.signup('alice', 'correcthorse123')
    const { token: tokenB } = await root.auth.login('alice', 'correcthorse123')

    await root.auth.logout(tokenA)

    expect(await root.auth.verify(tokenA)).toBeUndefined()
    expect(await root.auth.verify(tokenB)).toBeDefined()
  })

  it('setActive(false) -> deactivate + thu hồi TOÀN BỘ token hiện có (logout cưỡng bức)', async () => {
    const { root } = await bootWithFreshSchema()
    const { token, user } = await root.auth.signup('alice', 'correcthorse123')
    const bob = await root.auth.signup('bob', 'correcthorse123')
    await root.auth.setRole(bob.user.id, 'admin') // admin thứ 2 để alice không phải admin cuối

    await root.auth.setActive(user.id, false)

    expect(await root.auth.verify(token)).toBeUndefined()
    await expect(root.auth.login('alice', 'correcthorse123')).rejects.toMatchObject({ status: 401 })
  })

  it('last-admin guard: setActive(false)/setRole("user")/deleteUser đều chặn nếu là admin CUỐI CÙNG', async () => {
    const { root } = await bootWithFreshSchema()
    const { user } = await root.auth.signup('alice', 'correcthorse123') // admin duy nhất

    await expect(root.auth.setActive(user.id, false)).rejects.toMatchObject({ status: 409 })
    await expect(root.auth.setRole(user.id, 'user')).rejects.toMatchObject({ status: 409 })
    await expect(root.auth.deleteUser(user.id)).rejects.toMatchObject({ status: 409 })

    // Thêm 1 admin thứ 2 -> guard hết chặn vì không còn là admin CUỐI.
    const bob = await root.auth.signup('bob', 'correcthorse123')
    await root.auth.setRole(bob.user.id, 'admin')
    await expect(root.auth.setRole(user.id, 'user')).resolves.toBeUndefined()
  })

  it('listUsers trả đủ user, deleteUser xoá thật + cascade token', async () => {
    const { root } = await bootWithFreshSchema()
    await root.auth.signup('alice', 'correcthorse123')
    const bob = await root.auth.signup('bob', 'correcthorse123')

    expect((await root.auth.listUsers()).map((u) => u.username).sort()).toEqual(['alice', 'bob'])

    await root.auth.deleteUser(bob.user.id)
    expect(await root.auth.verify(bob.token)).toBeUndefined()
    expect((await root.auth.listUsers()).map((u) => u.username)).toEqual(['alice'])
  })
})
