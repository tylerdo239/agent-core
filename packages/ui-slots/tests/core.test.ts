// Phase 9.1 deliverable: test thuần cho SlotCore, KHÔNG cần React/Cordis —
// tự viết test cho ĐÚNG bản đơn giản hoá của agent-core, không port test của
// dsh rồi tin nó khớp (dsh có thêm 'chain' kind/store/locale mà bản này
// không có).
import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '../src/core.ts'

describe('Phase 9.1 — SlotCore', () => {
  it('declare() 2 lần cùng tên -> throw', () => {
    const core = new SlotCore()
    core.declare('a', 'single')
    expect(() => core.declare('a', 'list')).toThrow(/already declared/)
  })

  it('register() vào slot chưa declare() -> throw', () => {
    const core = new SlotCore()
    expect(() => core.register('ghost', { component: () => null })).toThrow(/is not declared/)
  })

  it("slot kind 'keyed': thiếu key -> throw; trùng key -> throw; entries() trả đúng entry theo key", () => {
    const core = new SlotCore()
    core.declare('tool.call.toolview', 'keyed')
    expect(() => core.register('tool.call.toolview', { component: () => null })).toThrow(/requires entry\.key/)

    const compA = () => 'A'
    core.register('tool.call.toolview', { key: 'web_search', component: compA })
    expect(() =>
      core.register('tool.call.toolview', { key: 'web_search', component: () => 'B' }),
    ).toThrow(/already has an entry for key "web_search"/)

    const entries = core.entries('tool.call.toolview')
    expect(entries.length).toBe(1)
    expect(entries[0].component).toBe(compA)
  })

  it("slot kind 'list': thiếu id -> throw; nhiều entry cùng tồn tại, sort theo order (mặc định 0, cùng order giữ thứ tự đăng ký)", () => {
    const core = new SlotCore()
    core.declare('toolbar', 'list')
    expect(() => core.register('toolbar', { component: () => null })).toThrow(/requires entry\.id/)

    core.register('toolbar', { id: 'b', component: () => 'B', order: 2 })
    core.register('toolbar', { id: 'a', component: () => 'A', order: 1 })
    core.register('toolbar', { id: 'c-no-order-1', component: () => 'C1' })
    core.register('toolbar', { id: 'c-no-order-2', component: () => 'C2' })

    // 2 entry không khai order coi như order=0, đứng trước 'a' (order=1) —
    // và GIỮ ĐÚNG thứ tự đăng ký với nhau (sort ổn định).
    expect(core.entries('toolbar').map((e) => e.id)).toEqual(['c-no-order-1', 'c-no-order-2', 'a', 'b'])
  })

  it("slot kind 'single': đăng ký lần 2 -> throw (không âm thầm cho phép 2 registrant tranh 1 vị trí)", () => {
    const core = new SlotCore()
    core.declare('theme.picker', 'single')
    core.register('theme.picker', { component: () => 'first' })
    expect(() => core.register('theme.picker', { component: () => 'second' })).toThrow(
      /is a 'single' slot and already has a registrant/,
    )
  })

  it('entries() cho slot chưa ai register -> mảng rỗng, không throw', () => {
    const core = new SlotCore()
    core.declare('empty', 'keyed')
    expect(core.entries('empty')).toEqual([])
  })

  it('register() trả về disposer -- gọi disposer thì entry biến mất khỏi entries() và notify() subscriber', () => {
    const core = new SlotCore()
    core.declare('tool.call.toolview', 'keyed')
    const onChange = vi.fn()
    core.subscribe('tool.call.toolview', onChange)

    const dispose = core.register('tool.call.toolview', { key: 'x', component: () => null })
    expect(onChange).toHaveBeenCalledTimes(1) // notify lúc register
    expect(core.entries('tool.call.toolview').length).toBe(1)

    dispose()
    expect(onChange).toHaveBeenCalledTimes(2) // notify lúc dispose
    expect(core.entries('tool.call.toolview')).toEqual([])

    // Sau khi dispose, register lại đúng key đó KHÔNG bị coi là trùng nữa.
    expect(() => core.register('tool.call.toolview', { key: 'x', component: () => null })).not.toThrow()
  })

  it('subscribe() trả về unsubscribe -- gọi rồi thì không nhận notify nữa', () => {
    const core = new SlotCore()
    core.declare('s', 'list')
    const onChange = vi.fn()
    const unsubscribe = core.subscribe('s', onChange)
    unsubscribe()
    core.register('s', { id: 'x', component: () => null })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('subscribe() slot A không bị notify khi slot B thay đổi (đúng theo tên, không broadcast toàn cục)', () => {
    const core = new SlotCore()
    core.declare('a', 'keyed')
    core.declare('b', 'keyed')
    const onChangeA = vi.fn()
    core.subscribe('a', onChangeA)
    core.register('b', { key: 'x', component: () => null })
    expect(onChangeA).not.toHaveBeenCalled()
  })
})
