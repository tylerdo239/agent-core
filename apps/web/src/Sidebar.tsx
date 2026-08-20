// apps/web/src/Sidebar.tsx — layout 2 cột (sidebar + khung chat chính) lấy
// CẢM HỨNG từ SidebarRoot thật của dsh (packages/client/ui-sidebar, đọc
// source thật để nắm đúng pattern: thu gọn còn 1 rail icon-only thay vì ẩn
// hẳn sidebar, hàng "Settings" nằm cố định cuối sidebar mở panel cấu hình) —
// KHÔNG copy nguyên JSX/CSS gốc, viết lại 100% bằng token (packages/ui-theme)
// và component (packages/ui-primitives) riêng của agent-core. Đơn giản hoá
// có chủ đích so với bản gốc (coding rule A6): không có logic "quiet
// scrollbar theo con trỏ" hay 2-pha slide/settle riêng cho từng control —
// 1 CSS transition trên width là đủ cho nhu cầu thật hiện tại (agent-core
// không có sidebar nhiều panel như dsh).
import { useState } from 'react'
import { Button, Tooltip } from '@agent-core/ui-primitives'
import { loadSidebarCollapsed, saveSidebarCollapsed } from './sidebarState.ts'
import type { SessionSummary } from './sessionHistory.ts'

export interface SidebarProps {
  sessions: SessionSummary[]
  activeSessionId: string | null
  onNewChat: () => void
  onSelectSession: (id: string) => void
  /** Mở modal cấu hình (REST/WS URL, API key) — hàng "Cấu hình" cuối sidebar,
   * thay cho nút bánh răng trong header cũ (xem App.tsx, quyết định gỡ hẳn
   * để tránh 2 lối vào cùng 1 modal — đúng pattern trigger-cuối-sidebar
   * thật của dsh, không phải avatar/profile vì app này không có tài khoản
   * người dùng thật). */
  onOpenSettings: () => void
}

export function Sidebar({ sessions, activeSessionId, onNewChat, onSelectSession, onOpenSettings }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => loadSidebarCollapsed())

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      saveSidebarCollapsed(next)
      return next
    })
  }

  return (
    <aside id="sidebar" className={collapsed ? 'sidebar-collapsed' : undefined}>
      <div className="sidebar-top">
        <Tooltip label={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}>
          <button type="button" className="sidebar-icon-btn" aria-label={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'} onClick={toggleCollapsed}>
            {collapsed ? '»' : '«'}
          </button>
        </Tooltip>
      </div>

      {collapsed ? (
        <Tooltip label="Chat mới">
          <Button type="button" variant="primary" onClick={onNewChat} className="sidebar-new-chat sidebar-new-chat-collapsed" aria-label="Chat mới">
            +
          </Button>
        </Tooltip>
      ) : (
        <Button type="button" variant="primary" onClick={onNewChat} className="sidebar-new-chat">
          + Chat mới
        </Button>
      )}

      {!collapsed && (
        <nav aria-label="Lịch sử hội thoại" className="sidebar-history">
          {sessions.length === 0 ? (
            <p className="sidebar-empty">Chưa có cuộc trò chuyện nào</p>
          ) : (
            <ul className="sidebar-session-list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`sidebar-session-item${s.id === activeSessionId ? ' active' : ''}`}
                    onClick={() => onSelectSession(s.id)}
                    title={s.title}
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      )}

      <div className="sidebar-foot">
        {collapsed ? (
          <Tooltip label="Cấu hình">
            <button type="button" className="sidebar-settings-trigger sidebar-settings-trigger-collapsed" aria-label="Cấu hình" onClick={onOpenSettings}>
              <span aria-hidden="true">⚙</span>
            </button>
          </Tooltip>
        ) : (
          <button type="button" className="sidebar-settings-trigger" onClick={onOpenSettings}>
            <span aria-hidden="true">⚙</span>
            <span className="sidebar-settings-label">Cấu hình</span>
          </button>
        )}
      </div>
    </aside>
  )
}
