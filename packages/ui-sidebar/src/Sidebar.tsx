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
//
// Icon (2026-08, follow-up): user yêu cầu đổi hẳn glyph text (🔍/«/»/⚙) sang
// 1 bộ icon thật — thêm `lucide-react` (SVG thuần, zero dependency, đủ nhẹ
// để chấp nhận thêm 1 dependency mới, khác quyết định "giữ emoji" trước đó
// ở Phase 16 vốn áp dụng cho icon DO TOOL BACKEND khai (`ToolUiHint.icon`,
// seams/tools.ts) — phần đó KHÔNG đổi, vẫn là string emoji tool tự chọn.
// `PanelLeftClose`/`PanelLeftOpen` đúng ngữ nghĩa "đóng/mở sidebar" user yêu
// cầu, không phải mũi tên chung chung nữa.
//
// Search (2026-08, follow-up thứ 2): đổi từ input mở rộng ngay trong sidebar
// sang 1 modal giữa màn hình (nền mờ blur, debounce + skeleton lúc "đang
// tải") — xem SearchModal.tsx. Sidebar giờ chỉ giữ đúng 1 việc: nút mở
// modal đó, danh sách lịch sử ở đây KHÔNG lọc nữa (lọc là việc của modal).
//
// Nhóm theo ngày (2026-08, follow-up thứ 3): "Hôm nay"/"Hôm qua"/ngày cụ thể
// — xem groupSessionsByDate.ts. CHỈ áp dụng cho list chính ở đây, KHÔNG áp
// dụng cho SearchModal (đang search theo từ khoá thì việc gom theo ngày
// không có ý nghĩa, kết quả vốn đã được lọc theo mức độ liên quan).
//
// Module auth (nhiều người dùng thật): app giờ CÓ tài khoản người dùng thật
// (khác ghi chú cũ ở onOpenSettings dưới đây, đã lỗi thời) — footer thêm 1
// hàng hiện username + nút đăng xuất, và (chỉ admin) 1 trigger "Quản lý
// người dùng" riêng, tách biệt với "Cấu hình" (URL kết nối, không liên quan
// tài khoản).
import { useState } from 'react'
import { Database, LogOut, PanelLeftClose, PanelLeftOpen, Puzzle, Search, Settings, Users } from 'lucide-react'
import { Button, Tooltip } from '@agent-core/ui-primitives'
import { loadSidebarCollapsed, saveSidebarCollapsed } from './sidebarState.ts'
import { groupSessionsByDate } from './groupSessionsByDate.ts'
import { SearchModal } from './SearchModal.tsx'
import type { SessionSummary } from './sessionHistory.ts'
import styles from './Sidebar.module.css'

export interface SidebarProps {
  sessions: SessionSummary[]
  activeSessionId: string | null
  onNewChat: () => void
  /** docs/agent-core-rlm-web-ui-plugin-plan.md mục 3 — tạo session MỚI với
   * driver 'rlm' (KHÔNG đổi driver session đang chạy — RLM giữ Python REPL
   * persistent gắn 1-1 với sessionId, trộn 2 loại loop trên cùng session
   * tạo ngữ nghĩa mơ hồ). */
  onNewDataSession: () => void
  onSelectSession: (id: string) => void
  /** Mở modal cấu hình (chỉ REST/WS URL — API key đã bỏ, xem
   * packages/ui-settings-general/src/settings.ts). */
  onOpenSettings: () => void
  isAdmin: boolean
  onOpenAdminPanel: () => void
  /** Tham khảo dsh (packages/client/ui-settings-plugin-inventory) — panel
   * read-only liệt kê bundle đang mount + trạng thái Fiber, xem
   * packages/ui-plugin-inventory. Admin-only cùng lý do AdminUsersPanel:
   * thông tin hạ tầng nội bộ, không phải thứ user thường cần thấy. */
  onOpenPluginInventory: () => void
  currentUsername: string
  onLogout: () => void
}

export function Sidebar({
  sessions,
  activeSessionId,
  onNewChat,
  onNewDataSession,
  onSelectSession,
  onOpenSettings,
  isAdmin,
  onOpenAdminPanel,
  onOpenPluginInventory,
  currentUsername,
  onLogout,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => loadSidebarCollapsed())
  const [searchOpen, setSearchOpen] = useState(false)

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      saveSidebarCollapsed(next)
      return next
    })
  }

  return (
    <aside id="sidebar" className={collapsed ? `${styles.sidebar} ${styles.collapsed}` : styles.sidebar}>
      <div className={styles.top}>
        {!collapsed && (
          <div className={styles.brand}>
            <span className={styles.logoMark} aria-hidden="true">A</span>
            <span className={styles.logoText}>agent-core</span>
          </div>
        )}
        {!collapsed && (
          <div className={styles.topActions}>
            <Tooltip label="Tìm cuộc trò chuyện">
              <button type="button" className={styles.iconBtn} aria-label="Tìm cuộc trò chuyện" onClick={() => setSearchOpen(true)}>
                <Search size={16} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="Thu gọn sidebar">
              <button type="button" className={styles.iconBtn} aria-label="Thu gọn sidebar" onClick={toggleCollapsed}>
                <PanelLeftClose size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}
        {collapsed && (
          <Tooltip label="Mở rộng sidebar">
            <button type="button" className={styles.iconBtn} aria-label="Mở rộng sidebar" onClick={toggleCollapsed}>
              <PanelLeftOpen size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </div>

      {collapsed ? (
        <Tooltip label="Chat mới">
          <Button type="button" variant="primary" onClick={onNewChat} className={`${styles.newChat} ${styles.newChatCollapsed}`} aria-label="Chat mới">
            +
          </Button>
        </Tooltip>
      ) : (
        <Button type="button" variant="primary" onClick={onNewChat} className={styles.newChat}>
          + Chat mới
        </Button>
      )}

      {/* docs/agent-core-rlm-web-ui-plugin-plan.md mục 3 — entry point RIÊNG
          cho session RLM, luôn tạo session MỚI. 'default' (nút trên) vẫn là
          lựa chọn mặc định, RLM là hành động chủ động — tái dùng style
          .settingsTrigger (icon+label phụ, cùng kiểu "Cấu hình"/"Quản lý
          người dùng" ở footer) thay vì tạo class mới, đủ phân biệt trực
          quan với nút primary "+ Chat mới" phía trên. */}
      {collapsed ? (
        <Tooltip label="Phân tích dữ liệu">
          <button
            type="button"
            onClick={onNewDataSession}
            className={`${styles.settingsTrigger} ${styles.settingsTriggerCollapsed}`}
            aria-label="Phân tích dữ liệu"
          >
            <Database size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      ) : (
        <button type="button" onClick={onNewDataSession} className={styles.settingsTrigger}>
          <Database size={16} aria-hidden="true" />
          <span className={styles.settingsLabel}>Phân tích dữ liệu</span>
        </button>
      )}

      {/* Luôn render (khác trước đây, unmount hẳn khi collapsed) — collapse
          giờ là crossfade opacity riêng của .history, độc lập với width
          transition của .sidebar, đọc mượt hơn 1 cú "unmount đột ngột". */}
      <nav aria-label="Lịch sử hội thoại" className={collapsed ? `${styles.history} ${styles.historyCollapsed}` : styles.history}>
        {sessions.length === 0 ? (
          <p className={styles.empty}>Chưa có cuộc trò chuyện nào</p>
        ) : (
          groupSessionsByDate(sessions).map((group) => (
            <div key={group.label} className={styles.dateGroup}>
              <p className={styles.dateGroupLabel}>{group.label}</p>
              <ul className={styles.sessionList}>
                {group.sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={s.id === activeSessionId ? `${styles.sessionItem} ${styles.sessionItemActive}` : styles.sessionItem}
                      onClick={() => onSelectSession(s.id)}
                      title={s.driver === 'rlm' ? `${s.title} (phân tích dữ liệu)` : s.title}
                      tabIndex={collapsed ? -1 : undefined}
                    >
                      {/* docs/agent-core-rlm-web-ui-plugin-plan.md mục 4 —
                          phân biệt session RLM với chat thường ngay trong
                          lịch sử, không cần bấm vào mới biết. */}
                      {s.driver === 'rlm' && <Database size={12} className={styles.sessionDriverBadge} aria-hidden="true" />}
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>

      <div className={styles.foot}>
        {!collapsed && (
          <div className={styles.userRow}>
            <span className={styles.username} title={currentUsername}>
              {currentUsername}
            </span>
            <Tooltip label="Đăng xuất">
              <button type="button" className={styles.iconBtn} aria-label="Đăng xuất" onClick={onLogout}>
                <LogOut size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}
        {collapsed && (
          <Tooltip label="Đăng xuất">
            <button type="button" className={styles.iconBtn} aria-label="Đăng xuất" onClick={onLogout}>
              <LogOut size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        )}

        {isAdmin &&
          (collapsed ? (
            <Tooltip label="Quản lý người dùng">
              <button
                type="button"
                className={`${styles.settingsTrigger} ${styles.settingsTriggerCollapsed}`}
                aria-label="Quản lý người dùng"
                onClick={onOpenAdminPanel}
              >
                <Users size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          ) : (
            <button type="button" className={styles.settingsTrigger} onClick={onOpenAdminPanel}>
              <Users size={16} aria-hidden="true" />
              <span className={styles.settingsLabel}>Quản lý người dùng</span>
            </button>
          ))}

        {isAdmin &&
          (collapsed ? (
            <Tooltip label="Plugin đang chạy">
              <button
                type="button"
                className={`${styles.settingsTrigger} ${styles.settingsTriggerCollapsed}`}
                aria-label="Plugin đang chạy"
                onClick={onOpenPluginInventory}
              >
                <Puzzle size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          ) : (
            <button type="button" className={styles.settingsTrigger} onClick={onOpenPluginInventory}>
              <Puzzle size={16} aria-hidden="true" />
              <span className={styles.settingsLabel}>Plugin đang chạy</span>
            </button>
          ))}

        {collapsed ? (
          <Tooltip label="Cấu hình">
            <button type="button" className={`${styles.settingsTrigger} ${styles.settingsTriggerCollapsed}`} aria-label="Cấu hình" onClick={onOpenSettings}>
              <Settings size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        ) : (
          <button type="button" className={styles.settingsTrigger} onClick={onOpenSettings}>
            <Settings size={16} aria-hidden="true" />
            <span className={styles.settingsLabel}>Cấu hình</span>
          </button>
        )}
      </div>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} sessions={sessions} onSelectSession={onSelectSession} />
    </aside>
  )
}
