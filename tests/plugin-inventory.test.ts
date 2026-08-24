// seams/plugin-inventory.ts — ctx.pluginInventory.list() đọc trực tiếp
// records/fiber.state mỗi lần gọi (point-in-time, không cache) — test xác
// nhận: map đúng toàn bộ 6 FiberState, đọc SỐNG khi fiber.state đổi giữa 2
// lần gọi list() liên tiếp, và thấy được record push THÊM vào mảng gốc SAU
// khi plugin-inventory đã mount (đúng thiết kế src/serve.ts — mount()
// truyền thẳng tham chiếu mảng, không copy, nên api-rest/api-ws/... mount
// sau plugin-inventory vẫn xuất hiện đúng trong list() gọi lúc có request).
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as pluginInventory from '../bundles/providers/plugin-inventory/index.ts'
import type { MountRecord } from '../bundles/providers/plugin-inventory/index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('plugin-inventory — list() map đúng state, đọc sống', () => {
  it('map đủ 6 FiberState (0..5) sang đúng nhãn tài liệu hoá tại fiber.d.ts', async () => {
    const root = new Context()
    const records: MountRecord[] = [
      { name: 'a-pending', category: 'provider', fiber: { state: 0 } },
      { name: 'b-loading', category: 'provider', fiber: { state: 1 } },
      { name: 'c-active', category: 'tool', fiber: { state: 2 } },
      { name: 'd-failed', category: 'tool', fiber: { state: 3 } },
      { name: 'e-disposed', category: 'skill', fiber: { state: 4 } },
      { name: 'f-unloading', category: 'loop-driver', fiber: { state: 5 } },
    ]
    root.plugin(pluginInventory, records)
    await settle()

    expect(root.pluginInventory.list()).toEqual([
      { name: 'a-pending', category: 'provider', state: 'pending' },
      { name: 'b-loading', category: 'provider', state: 'loading' },
      { name: 'c-active', category: 'tool', state: 'active' },
      { name: 'd-failed', category: 'tool', state: 'failed' },
      { name: 'e-disposed', category: 'skill', state: 'disposed' },
      { name: 'f-unloading', category: 'loop-driver', state: 'unloading' },
    ])
  })

  it('đọc sống — fiber.state đổi giữa 2 lần gọi list() thấy giá trị mới ngay, không cache', async () => {
    const root = new Context()
    const mutableFiber = { state: 1 }
    const records: MountRecord[] = [{ name: 'x', category: 'provider', fiber: mutableFiber }]
    root.plugin(pluginInventory, records)
    await settle()

    expect(root.pluginInventory.list()).toEqual([{ name: 'x', category: 'provider', state: 'loading' }])
    mutableFiber.state = 2
    expect(root.pluginInventory.list()).toEqual([{ name: 'x', category: 'provider', state: 'active' }])
  })

  it('record push thêm vào mảng gốc SAU khi mount vẫn xuất hiện trong list()', async () => {
    const root = new Context()
    const records: MountRecord[] = [{ name: 'first', category: 'provider', fiber: { state: 2 } }]
    root.plugin(pluginInventory, records)
    await settle()

    records.push({ name: 'second', category: 'adapter', fiber: { state: 2 } })

    expect(root.pluginInventory.list().map((e) => e.name)).toEqual(['first', 'second'])
  })
})
