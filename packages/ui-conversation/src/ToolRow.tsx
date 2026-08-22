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
import { ChevronRight, CircleAlert } from 'lucide-react'
import styles from './ToolRow.module.css'

export interface ToolRowProps {
  /** Emoji do chính tool khai (`ToolUiHint.icon`, seams/tools.ts) — string
   * thuần, KHÔNG đổi sang icon component: đây là metadata backend-driven,
   * bất kỳ tool nào (kể cả thêm sau này) chỉ cần khai 1 ký tự emoji, không
   * cần import bộ icon client. Chevron/lỗi bên dưới mới là icon chrome do
   * chính ToolRow sở hữu — đổi sang lucide-react (theo yêu cầu đổi icon
   * text sang bộ icon thật, 2026-08). */
  icon: string
  title: string
  summary: string
  state: 'running' | 'ok' | 'error'
  children?: ReactNode
}

export function ToolRow({ icon, title, summary, state, children }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const expandable = state === 'ok'

  const toggle = () => {
    if (expandable) setExpanded((v) => !v)
  }

  const headerClasses = [styles.header, state === 'running' ? styles.headerRunning : '', expandable ? styles.headerClickable : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={styles.toolRow} data-state={state}>
      <div
        className={headerClasses}
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
        <span className={`${styles.icon}${state === 'error' ? ` ${styles.iconError}` : ''}`}>
          {state === 'error' ? <CircleAlert size={14} aria-hidden="true" /> : icon}
        </span>
        <span className={styles.title}>{title}</span>
        <span className={styles.sep}>·</span>
        <span className={`${styles.summary}${state === 'error' ? ` ${styles.summaryError}` : ''}`}>{summary}</span>
        {expandable && (
          <span className={`${styles.chevron}${expanded ? ` ${styles.chevronOpen}` : ''}`}>
            <ChevronRight size={14} aria-hidden="true" />
          </span>
        )}
      </div>
      {expandable && expanded && <div className={styles.body}>{children}</div>}
    </div>
  )
}
