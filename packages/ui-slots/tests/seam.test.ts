// Phase 9.2 deliverable: mount/unmount qua ctx.plugin() thật (cùng pattern
// tests/lifecycle-state-sqlite.test.ts), xác nhận ctx.slots hoạt động qua
// seam (truy cập qua `ctx.slots.*`, không new SlotRegistry() trực tiếp hay
// đọc internal). Hành vi declare/register/entries/subscribe THÂN của
// SlotCore đã test đầy đủ ở core.test.ts (9.1) — test ở đây chỉ verify phần
// WIRING (mount/unmount/truy cập qua ctx) không lặp lại.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as slotSeam from '../src/seam.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('Phase 9.2 — ctx.slots seam', () => {
  it('mount qua ctx.plugin() -> ctx.slots hoạt động đúng qua seam (không truy cập instance trực tiếp)', async () => {
    const root = new Context()
    const fiber = root.plugin(slotSeam)
    await settle()
    await fiber.await()

    root.slots.declare('tool.call.toolview', 'keyed')
    const CardA = () => 'A'
    const dispose = root.slots.register('tool.call.toolview', { key: 'web_search', component: CardA })

    expect(root.slots.entries('tool.call.toolview').length).toBe(1)
    expect(root.slots.entries('tool.call.toolview')[0].component).toBe(CardA)

    dispose()
    expect(root.slots.entries('tool.call.toolview')).toEqual([])

    await fiber.dispose()
  })

  it('mount -> unmount -> ctx.slots không còn truy cập được (service đã dispose sạch, đúng pattern A4)', async () => {
    const root = new Context()
    const fiber = root.plugin(slotSeam)
    await settle()
    await fiber.await()

    root.slots.declare('s', 'single')
    expect(root.reflect.get('slots', false)).toBeTruthy()

    await fiber.dispose()

    expect(root.reflect.get('slots', false)).toBeUndefined()
  })

  it('mount lại sau khi unmount tạo instance MỚI -- slot đã declare() ở lần mount trước KHÔNG còn (không rò rỉ state qua lần mount)', async () => {
    const root = new Context()
    const fiber1 = root.plugin(slotSeam)
    await settle()
    await fiber1.await()
    root.slots.declare('s', 'single')
    await fiber1.dispose()

    const fiber2 = root.plugin(slotSeam)
    await settle()
    await fiber2.await()

    // Slot 's' không còn tồn tại từ instance cũ -- declare lại được, không throw "already declared".
    expect(() => root.slots.declare('s', 'single')).not.toThrow()

    await fiber2.dispose()
  })

  it('subscribe() qua seam nhận đúng notify khi register()/dispose() qua seam', async () => {
    const root = new Context()
    const fiber = root.plugin(slotSeam)
    await settle()
    await fiber.await()

    root.slots.declare('toolbar', 'list')
    let notified = 0
    root.slots.subscribe('toolbar', () => notified++)

    const dispose = root.slots.register('toolbar', { id: 'x', component: () => null })
    expect(notified).toBe(1)
    dispose()
    expect(notified).toBe(2)

    await fiber.dispose()
  })
})
