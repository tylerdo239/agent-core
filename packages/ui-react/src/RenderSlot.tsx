// packages/ui-react/src/RenderSlot.tsx — Phase 9.3: component tiện ích,
// tương đương `renderSlot()` bên dsh — dispatch 1 entry cụ thể (slot kind
// 'keyed' qua entryKey, hoặc 'single' khi bỏ qua entryKey) ra component thật
// của entry đó, hoặc `fallback` nếu không có entry khớp.
//
// Gap thật phát hiện qua audit (đối chiếu docs/agent-core-master-summary.md
// mục 7): trước đây KHÔNG có Error Boundary nào — nếu component của entry
// (hoặc chính `fallback`) throw lúc render, lỗi lan ra tới tận React root,
// crash TOÀN BỘ trang, không chỉ đúng 1 tool-row. Giờ bọc cả 2 trường hợp
// (Component thật lẫn fallback) trong CÙNG 1 `SlotErrorBoundary` — nếu 1
// trong 2 throw, hiện `errorFallback` tĩnh (không gọi lại code người khác
// viết, tránh throw lặp vô hạn).
//
// CHỦ ĐÍCH KHÔNG hỗ trợ render TOÀN BỘ entries của 1 slot 'list' (kiểu
// toolbar nhiều registrant cùng hiện) — chưa có consumer thật nào cần việc
// đó trong phạm vi Phase 9 hiện tại (slot duy nhất đang dùng,
// `tool.call.toolview`, là 'keyed'). Build thêm primitive đó khi có nhu cầu
// thật thứ 2 (coding rule A6), không đoán trước.
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { SlotErrorBoundary } from './SlotErrorBoundary.tsx'
import { useSlotEntries } from './useSlot.ts'

export interface RenderSlotProps<Owner extends object> {
  ctx: Context
  name: string
  /** Bắt buộc cho slot kind 'keyed' — tìm entry có entry.key === entryKey. Bỏ qua (lấy entries[0]) cho slot kind 'single'. */
  entryKey?: string
  /** Props truyền cho component của entry tìm được (hoặc fallback). */
  owner: Owner
  /**
   * Component dùng khi không tìm thấy entry khớp — BẮT BUỘC truyền, không có
   * mặc định ngầm (coding rule A15: 1 tool/slot thiếu registrant không được
   * phép làm crash cả trang).
   */
  fallback: (props: Owner) => ReactNode
  /** Node tĩnh hiện khi CHÍNH Component/fallback throw lúc render — không nhận props, không được phép tự throw. */
  errorFallback?: ReactNode
}

const DEFAULT_ERROR_FALLBACK = <span>Không thể hiển thị nội dung này.</span>

export function RenderSlot<Owner extends object>({
  ctx,
  name,
  entryKey,
  owner,
  fallback,
  errorFallback = DEFAULT_ERROR_FALLBACK,
}: RenderSlotProps<Owner>) {
  const entries = useSlotEntries(ctx, name)
  const entry = entryKey === undefined ? entries[0] : entries.find((e) => e.key === entryKey)
  const Component = (entry?.component ?? fallback) as (props: Owner) => ReactNode
  return (
    <SlotErrorBoundary fallback={errorFallback}>
      <Component {...owner} />
    </SlotErrorBoundary>
  )
}
