// Phase 2 deliverable: mount → unmount → resource (SQLite connection) sạch
// hoàn toàn. Không dùng --detectOpenHandles (đặc thù Jest) — thay vào đó xác
// nhận trực tiếp: sau khi fiber dispose, connection đã bị `close()` thật sự
// (thao tác tiếp theo trên nó phải throw), và service không còn truy cập
// được qua ctx.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import { SqliteStorage } from '../bundles/providers/state-sqlite/index.ts'

describe('state-sqlite lifecycle (temporal composability)', () => {
  it('mount tạo connection dùng được, unmount đóng connection sạch', async () => {
    const root = new Context()
    const fiber = root.plugin(stateSqlite, { path: ':memory:' })
    await fiber.await()

    await root.storage.appendEvent('s1', { type: 'model_message', content: 'hi' })
    const events = await root.storage.readEvents('s1')
    expect(events).toEqual([{ type: 'model_message', content: 'hi' }])

    // Giữ tham chiếu instance thật để kiểm tra connection có bị close() không.
    const impl = root.reflect.get('storage', false) as InstanceType<typeof SqliteStorage>

    await fiber.dispose()

    expect(root.reflect.get('storage', false)).toBeUndefined()
    expect(() => (impl as any).db.prepare('SELECT 1').get()).toThrow()
  })

  it('mount lại sau khi unmount tạo connection MỚI, không tái sử dụng connection cũ', async () => {
    const root = new Context()
    const fiber1 = root.plugin(stateSqlite, { path: ':memory:' })
    await fiber1.await()
    await root.storage.appendEvent('s1', { type: 'x' })
    await fiber1.dispose()

    const fiber2 = root.plugin(stateSqlite, { path: ':memory:' })
    await fiber2.await()
    // DB mới (":memory:" mới) không còn event cũ.
    const events = await root.storage.readEvents('s1')
    expect(events).toEqual([])

    await fiber2.dispose()
  })
})
