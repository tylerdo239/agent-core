// packages/ui-tool-web-search/src/WebSearchCard.tsx — Phase 9.5: UI-plugin
// THẬT cho tool_web_search — khác biệt VỀ LOẠI so với GenericToolCard
// (Phase 8.5/9.4): có STATE CỤC BỘ (toggle từng snippet) + 1 HÀNH ĐỘNG
// (mở tất cả link) — 2 thứ không thể biểu diễn được bằng `ToolUiHint`
// (icon/label/render-kind cố định), đây chính là điểm dsh's `ctx.slots`
// hơn hẳn cơ chế metadata (xác nhận qua đọc source thật dsh, xem Phase 9.0).
//
// Coding rule (docs/ui-plugin-build-guide.md mục 4): không throw khi result
// thiếu field/sai shape (validate trước khi destructure), không tự gọi
// network/localStorage riêng — mọi dữ liệu cần đã có trong props.
import { useState } from 'react'
import type { ToolViewOwnerProps } from '@agent-core/ui-slots'
import { Button } from '@agent-core/ui-primitives'
import './WebSearchCard.css'

interface SearchResult {
  title?: string
  url: string
  snippet?: string
}

function sourceLabel(url: string, title?: string): string {
  if (title) return title
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function WebSearchCard({ result }: ToolViewOwnerProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<number>>(new Set())

  const parsed = result as { results?: SearchResult[] } | null | undefined
  const results = Array.isArray(parsed?.results) ? parsed!.results! : []

  if (!results.length) return <p className="tool-io-text">không tìm thấy kết quả</p>

  function toggle(i: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function openAll() {
    for (const r of results) window.open(r.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="web-search-card">
      <Button type="button" size="sm" onClick={openAll}>
        Mở tất cả ({results.length}) trong tab mới
      </Button>
      <ol className="tool-sources">
        {results.map((r, i) => (
          <li className="tool-source" key={r.url + i}>
            <a className="tool-source-link" href={r.url} target="_blank" rel="noopener noreferrer">
              {sourceLabel(r.url, r.title)}
            </a>
            {r.snippet && (
              <>
                <Button type="button" size="sm" onClick={() => toggle(i)}>
                  {expandedIds.has(i) ? 'ẩn mô tả' : 'xem mô tả'}
                </Button>
                {expandedIds.has(i) && <div className="tool-source-snippet">{r.snippet}</div>}
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
