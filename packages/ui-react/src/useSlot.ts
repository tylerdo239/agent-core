// packages/ui-react/src/useSlot.ts — Phase 9.3: binding React cho ctx.slots
// (9.2) qua useSyncExternalStore — re-render đúng lúc slot thay đổi (đăng ký
// mới / gỡ đăng ký giữa lúc app đang chạy), không cần cây React cha tự quản
// lý state riêng cho việc này.
//
// Phase 9.6: npm workspaces đã dựng xong — import qua bare specifier
// `@agent-core/ui-slots` (trước đó dùng relative import vì chưa resolve
// được, xem lịch sử Phase 9.3 trong build plan).
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SlotEntry } from '@agent-core/ui-slots'
import '@agent-core/ui-slots'

export function useSlotEntries(ctx: Context, name: string): readonly SlotEntry[] {
  return useSyncExternalStore(
    (onChange) => ctx.slots.subscribe(name, onChange),
    () => ctx.slots.entries(name),
  )
}
