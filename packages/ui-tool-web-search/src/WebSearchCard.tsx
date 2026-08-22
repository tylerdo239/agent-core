// packages/ui-tool-web-search/src/WebSearchCard.tsx — Phase 9.5: UI-plugin
// THẬT cho tool_web_search — khác biệt VỀ LOẠI so với GenericToolCard
// (Phase 8.5/9.4): có STATE CỤC BỘ (toggle từng snippet) + 1 HÀNH ĐỘNG
// (mở tất cả link) — 2 thứ không thể biểu diễn được bằng `ToolUiHint`
// (icon/label/render-kind cố định), đây chính là điểm dsh's `ctx.slots`
// hơn hẳn cơ chế metadata (xác nhận qua đọc source thật dsh, xem Phase 9.0).
//
// UI redesign (2026-08): danh sách nguồn (toggle snippet + label/hostname
// fallback) giờ dùng SourceList dùng chung (packages/ui-primitives) — trước
// đây viết trùng gần như nguyên văn với GenericToolCard.tsx, 2 class name
// global riêng dễ va chạm (tool-source*), gộp về 1 implementation.
//
// Coding rule (docs/ui-plugin-build-guide.md mục 4): không throw khi result
// thiếu field/sai shape (validate trước khi destructure), không tự gọi
// network/localStorage riêng — mọi dữ liệu cần đã có trong props.
import type { ToolViewOwnerProps } from '@agent-core/ui-slots'
import { Button, SourceList } from '@agent-core/ui-primitives'
import styles from './WebSearchCard.module.css'

interface SearchResult {
  title?: string
  url: string
  snippet?: string
}

export function WebSearchCard({ result }: ToolViewOwnerProps) {
  const parsed = result as { results?: SearchResult[] } | null | undefined
  const results = Array.isArray(parsed?.results) ? parsed!.results! : []

  if (!results.length) return <SourceList results={[]} />

  function openAll() {
    for (const r of results) window.open(r.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className={styles.card}>
      <Button type="button" size="sm" onClick={openAll}>
        Mở tất cả ({results.length}) trong tab mới
      </Button>
      <SourceList results={results} collapsibleSnippets />
    </div>
  )
}
