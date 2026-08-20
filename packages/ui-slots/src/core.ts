// packages/ui-slots/src/core.ts — Phase 9.1: slot registry lõi, framework-
// agnostic (KHÔNG import React/Cordis — package này chỉ là data structure +
// pub/sub thuần, để dùng lại được cả từ seam Cordis (9.2) lẫn test không cần
// dựng ctx).
//
// Port lại đúng phần lõi của SlotCore thật bên dsh, đơn giản hoá có chủ đích
// (bỏ 'chain' kind, bỏ store/locale — xem docs/agent-core-cordis-build-plan.md
// Phase 9.0) — nhưng viết lại từ đầu + tự test, không copy nguyên code rồi
// tin nó đúng cho đúng bản đơn giản hoá của mình.
//
// 2 chỗ khác bản nháp trong build plan (phát hiện khi implement, không phải
// chỉ chép lại): (1) `order` từng chỉ là field khai báo không dùng tới ở đâu
// — entries() giờ SẮP XẾP theo order (mặc định 0, sort ổn định nên cùng order
// giữ đúng thứ tự đăng ký, JS Array#sort ổn định từ ES2019); (2) kind
// 'single' chưa có ràng buộc gì — register() giờ throw nếu đã có 1 entry,
// nhất quán với hành vi 'keyed' (fail rõ ràng thay vì âm thầm cho phép 2
// registrant tranh nhau 1 vị trí "chỉ có 1").

export type SlotKind = 'single' | 'list' | 'keyed'

export interface SlotEntry<P = any> {
  /** React component thật (hoặc bất kỳ hàm render nào) — package này không import React nên kiểu để `unknown`, ràng buộc ReactNode nằm ở packages/ui-react. */
  component: (props: P) => unknown
  /** Bắt buộc nếu slot kind = 'keyed'. */
  key?: string
  /** Bắt buộc nếu slot kind = 'list'. */
  id?: string
  /** Thứ tự hiển thị khi slot kind = 'list' (mặc định 0, cùng order giữ đúng thứ tự đăng ký). */
  order?: number
  /** Tên bundle đăng ký — debug, coding rule B7 áp dụng cả UI-plugin. */
  registrant?: string
}

interface SlotState {
  kind: SlotKind
  entries: SlotEntry[]
}

export class SlotCore {
  private slots = new Map<string, SlotState>()
  private listeners = new Map<string, Set<() => void>>()

  declare(name: string, kind: SlotKind) {
    if (this.slots.has(name)) throw new Error(`slot "${name}" already declared`)
    this.slots.set(name, { kind, entries: [] })
  }

  register<P>(name: string, entry: SlotEntry<P>): () => void {
    const slot = this.slots.get(name)
    if (!slot) throw new Error(`slot "${name}" is not declared`)
    if (slot.kind === 'keyed' && !entry.key) {
      throw new Error(`keyed slot "${name}" requires entry.key`)
    }
    if (slot.kind === 'list' && !entry.id) {
      throw new Error(`list slot "${name}" requires entry.id`)
    }
    if (slot.kind === 'keyed' && slot.entries.some((e) => e.key === entry.key)) {
      throw new Error(`slot "${name}" already has an entry for key "${entry.key}"`)
    }
    if (slot.kind === 'single' && slot.entries.length > 0) {
      throw new Error(`slot "${name}" is a 'single' slot and already has a registrant`)
    }

    const stored = entry as SlotEntry
    slot.entries = [...slot.entries, stored]
    this.notify(name)

    return () => {
      slot.entries = slot.entries.filter((e) => e !== stored)
      this.notify(name)
    }
  }

  entries(name: string): readonly SlotEntry[] {
    const slot = this.slots.get(name)
    if (!slot) return []
    if (slot.kind !== 'list') return slot.entries
    // Sort ổn định — entry cùng `order` (mặc định 0) giữ đúng thứ tự đăng ký.
    return [...slot.entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  subscribe(name: string, fn: () => void): () => void {
    const set = this.listeners.get(name) ?? new Set()
    set.add(fn)
    this.listeners.set(name, set)
    return () => set.delete(fn)
  }

  private notify(name: string) {
    for (const fn of this.listeners.get(name) ?? []) fn()
  }
}
