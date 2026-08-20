// Phase 8.4 deliverable: state-sqlite prune event cũ hơn retentionDays, KHÔNG
// đợi ngày thật trôi qua -- chỉnh created_at thẳng qua SQL thô (giống cách
// test lifecycle đã dùng root.reflect.get để lấy instance thật, xem
// tests/lifecycle-state-sqlite.test.ts). Không set retentionDays -> hành vi
// CŨ giữ nguyên (backward compatible, không âm thầm xoá dữ liệu của ai chưa
// yêu cầu retention) -- coding rule A14.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import { SqliteStorage } from '../bundles/providers/state-sqlite/index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

let dbDir: string | undefined

afterEach(() => {
  if (dbDir) rmSync(dbDir, { recursive: true, force: true })
  dbDir = undefined
})

describe('Phase 8.4 — state-sqlite retention', () => {
  it('event cũ hơn retentionDays bị prune, event mới giữ nguyên', async () => {
    const root = new Context()
    const fiber = root.plugin(stateSqlite, { path: ':memory:', retentionDays: 7, retentionSweepIntervalMs: 20 })
    await settle()
    await fiber.await()

    await root.storage.appendEvent('s1', { type: 'model_message', content: 'cũ' })
    await root.storage.appendEvent('s1', { type: 'model_message', content: 'mới' })

    // Chỉnh thẳng created_at của event "cũ" về 10 ngày trước qua SQL thô --
    // không đợi ngày thật trôi qua, đúng kỷ luật verify thực nghiệm đã dùng
    // xuyên suốt (không suy đoán prune logic hoạt động đúng).
    const impl = root.reflect.get('storage', false) as InstanceType<typeof SqliteStorage>
    ;(impl as any).db.prepare(`UPDATE events SET created_at = unixepoch() - ? WHERE payload LIKE '%cũ%'`).run(10 * 86400)

    // Đợi qua vài chu kỳ sweep (retentionSweepIntervalMs=20ms).
    await new Promise((r) => setTimeout(r, 80))

    const events = await root.storage.readEvents('s1')
    expect(events.map((e: any) => e.content)).toEqual(['mới'])

    await fiber.dispose()
  })

  it('KHÔNG set retentionDays -> event cũ KHÔNG bị xoá (backward compatible)', async () => {
    const root = new Context()
    const fiber = root.plugin(stateSqlite, { path: ':memory:' })
    await settle()
    await fiber.await()

    await root.storage.appendEvent('s1', { type: 'model_message', content: 'giữ mãi' })
    const impl = root.reflect.get('storage', false) as InstanceType<typeof SqliteStorage>
    ;(impl as any).db.prepare(`UPDATE events SET created_at = unixepoch() - ?`).run(365 * 86400)

    await new Promise((r) => setTimeout(r, 50))

    const events = await root.storage.readEvents('s1')
    expect(events.map((e: any) => e.content)).toEqual(['giữ mãi'])

    await fiber.dispose()
  })

  it('sweep prune chạy NGAY lúc mount (không chỉ đợi interval đầu tiên) -- event cũ ghi từ LẦN MOUNT TRƯỚC (file thật, không phải :memory:) bị dọn dù interval rất dài', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-core-retention-'))
    const dbPath = join(dir, 'sessions.db')
    dbDir = dir

    // Lần mount 1: KHÔNG bật retention -- seed 1 event, chỉnh created_at về
    // quá khứ, rồi unmount. Giả lập "service restart sau khi bật retention",
    // dữ liệu cũ đã nằm sẵn trong file TRƯỚC khi provider có retention chạy.
    const seedRoot = new Context()
    const seedFiber = seedRoot.plugin(stateSqlite, { path: dbPath })
    await settle()
    await seedFiber.await()
    await seedRoot.storage.appendEvent('s1', { type: 'model_message', content: 'đã cũ từ trước' })
    const seedImpl = seedRoot.reflect.get('storage', false) as InstanceType<typeof SqliteStorage>
    ;(seedImpl as any).db.prepare(`UPDATE events SET created_at = unixepoch() - ?`).run(5 * 86400)
    await seedFiber.dispose()

    // Lần mount 2: bật retentionDays=1 với sweepIntervalMs RẤT DÀI (10s) --
    // nếu prune() chỉ chạy qua setInterval, event cũ sẽ còn sống sau vài
    // chục ms chờ dưới đây. Assert nó KHÔNG còn -- chứng minh prune() chạy
    // ngay trong [Service.init](), không đợi chu kỳ interval đầu tiên.
    const root = new Context()
    const fiber = root.plugin(stateSqlite, { path: dbPath, retentionDays: 1, retentionSweepIntervalMs: 10_000 })
    await settle()
    await fiber.await()

    const events = await root.storage.readEvents('s1')
    expect(events).toEqual([])

    await fiber.dispose()
  })
})
