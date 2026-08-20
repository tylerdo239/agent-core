// apps/web/src/ToolRow.tsx — Phase 9.4: chrome CHUNG cho mọi tool call (icon
// + title + tóm tắt, collapsed-by-default, sweep shimmer khi running, click
// để mở rộng xem body) — port từ createToolRow()/settleToolRow() trong
// app.js cũ (Phase 7/8.5), viết lại thành component React có state cục bộ
// (`expanded`) thay vì thao tác DOM thủ công.
//
// Đây là phần HẠ TẦNG DÙNG CHUNG, KHÔNG phải nơi quyết định nội dung body —
// nội dung body (citations/IO card/component riêng của tool) là children,
// do App.tsx quyết định qua RenderSlot (xem seams/tools.ts ToolUiHint,
// packages/ui-slots slot 'tool.call.toolview').
//
// Đơn giản hoá so với app.js cũ: chỉ state 'ok' mới expandable — state
// 'error' trong app.js cũ CSS có rule cursor:pointer nhưng thực tế không bao
// giờ gắn click handler (bodyNode luôn null khi lỗi) nên chevron/click chưa
// từng thật sự hoạt động ở đó — giữ đúng hành vi THẬT, không giữ đúng CSS
// chết.
import { useState, type ReactNode } from 'react'

export interface ToolRowProps {
  icon: string
  title: string
  summary: string
  state: 'running' | 'ok' | 'error'
  children?: ReactNode
}

export function ToolRow({ icon, title, summary, state, children }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const expandable = state === 'ok'
  const displayIcon = state === 'error' ? '●' : icon

  const toggle = () => {
    if (expandable) setExpanded((v) => !v)
  }

  return (
    <div className="msg tool-row" data-state={state}>
      <div
        className="tool-row-header"
        tabIndex={expandable ? 0 : undefined}
        role={expandable ? 'button' : undefined}
        onClick={expandable ? toggle : undefined}
        onKeyDown={
          expandable
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggle()
                }
              }
            : undefined
        }
      >
        <span className={`tool-row-icon${state === 'error' ? ' tool-row-icon-error' : ''}`}>{displayIcon}</span>
        <span className="tool-row-title">{title}</span>
        <span className="tool-row-sep">·</span>
        <span className="tool-row-summary">{summary}</span>
        {expandable && <span className={`tool-row-chevron${expanded ? ' tool-row-chevron-open' : ''}`}>›</span>}
      </div>
      {expandable && expanded && <div className="tool-row-body">{children}</div>}
    </div>
  )
}
