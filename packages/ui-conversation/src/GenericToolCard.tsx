// apps/web/src/GenericToolCard.tsx — Phase 9.4: fallback BẮT BUỘC cho slot
// 'tool.call.toolview' — tool KHÔNG có UI-plugin riêng (đa số tool tương
// lai) vẫn hiển thị hợp lý qua đây. Đọc `toolUi.render` (Phase 8.5, forward
// qua LoopStep.toolUi) để chọn giữa 2 kiểu: 'citations' (danh sách nguồn
// đánh số, mirror WebBlock thật của dsh — dùng SourceList dùng chung, xem UI
// redesign 2026-08) hoặc 'io' — mặc định (card IN/OUT chung).
//
// Đơn giản hoá có chủ đích so với app.js cũ: citations rỗng giờ hiện 1 dòng
// "không tìm thấy kết quả" NGAY TRONG body (luôn trả về node, không null) —
// app.js cũ trả `null` để ToolRow tự gỡ chevron (không cho expand). Giữ luôn
// chevron mở được đơn giản hơn (ToolRow không cần biết body "có rỗng không"),
// đánh đổi UX chấp nhận được: xem Phase 9.4 trong build-plan.
import type { ToolViewOwnerProps } from '@agent-core/ui-slots'
import { SourceList } from '@agent-core/ui-primitives'
import styles from './GenericToolCard.module.css'

interface SearchResult {
  title?: string
  url: string
  snippet?: string
}

function IoCard({ inputText, result }: { inputText: string; result: unknown }) {
  return (
    <div className={styles.io}>
      <div className={styles.ioRow}>
        <span className={styles.ioLabel}>IN</span>
        <span className={styles.ioText}>{inputText}</span>
      </div>
      <div className={styles.ioRow}>
        <span className={styles.ioLabel}>OUT</span>
        <span className={styles.ioText}>{JSON.stringify(result)}</span>
      </div>
    </div>
  )
}

export function GenericToolCard({ toolCall, result, toolUi }: ToolViewOwnerProps) {
  const parsed = result as { results?: SearchResult[] } | null | undefined
  if (toolUi?.render === 'citations' && parsed && Array.isArray(parsed.results)) {
    return <SourceList results={parsed.results} />
  }
  return <IoCard inputText={JSON.stringify(toolCall.args ?? {})} result={result} />
}
