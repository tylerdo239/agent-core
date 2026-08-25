// bundles/providers/plugin-config-postgres — test THẬT chống lại Postgres
// thật (không mock `pg`, cùng kỷ luật tests/auth-users.test.ts). Cần
// DATABASE_URL trỏ tới 1 Postgres thật đang chạy.
//
// Mỗi test tự tạo 1 schema Postgres RIÊNG rồi xoá lúc cleanup — cô lập hoàn
// toàn giữa các test, đúng pattern tests/auth-users.test.ts.
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import pg from 'pg'
import * as pluginConfigPostgres from '../bundles/providers/plugin-config-postgres/index.ts'

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
  const fiber = root.plugin(pluginConfigPostgres, { connectionString: url.toString() })
  await new Promise((r) => setTimeout(r, 10))
  await fiber.await()

  cleanup = async () => {
    await fiber.dispose()
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.end()
  }
  return { root, fiber }
}

describe('bundles/providers/plugin-config-postgres (Postgres thật)', () => {
  it('get() key chưa tồn tại -> undefined, không throw', async () => {
    const { root } = await bootWithFreshSchema()
    expect(await root.pluginConfig.get('serperApiKey')).toBeUndefined()
  })

  it('set() rồi get() -> đọc lại đúng giá trị vừa lưu', async () => {
    const { root } = await bootWithFreshSchema()
    await root.pluginConfig.set('serperApiKey', 'real-key-123')
    expect(await root.pluginConfig.get('serperApiKey')).toBe('real-key-123')
  })

  it('set() 2 lần cùng key -> upsert, KHÔNG throw trùng khoá, giá trị là lần ghi sau cùng', async () => {
    const { root } = await bootWithFreshSchema()
    await root.pluginConfig.set('serperApiKey', 'first-value')
    await root.pluginConfig.set('serperApiKey', 'second-value')
    expect(await root.pluginConfig.get('serperApiKey')).toBe('second-value')
  })

  it('delete() -> get() trả undefined trở lại', async () => {
    const { root } = await bootWithFreshSchema()
    await root.pluginConfig.set('serperApiKey', 'x')
    await root.pluginConfig.delete('serperApiKey')
    expect(await root.pluginConfig.get('serperApiKey')).toBeUndefined()
  })

  it('delete() key chưa tồn tại -> không throw (idempotent)', async () => {
    const { root } = await bootWithFreshSchema()
    await expect(root.pluginConfig.delete('never-set')).resolves.toBeUndefined()
  })

  it('listConfiguredKeys() -> đúng danh sách key đang có giá trị, sắp xếp theo tên, KHÔNG trả giá trị thật', async () => {
    const { root } = await bootWithFreshSchema()
    await root.pluginConfig.set('zKey', 'secret-z')
    await root.pluginConfig.set('aKey', 'secret-a')
    const keys = await root.pluginConfig.listConfiguredKeys()
    expect(keys).toEqual(['aKey', 'zKey'])
  })
})
