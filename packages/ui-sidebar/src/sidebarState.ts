// apps/web/src/sidebarState.ts — Phase 14: nhớ trạng thái thu gọn/mở rộng
// sidebar qua reload, cùng quy ước localStorage với settings.ts/
// sessionHistory.ts (try/catch quanh JSON/localStorage, không throw khi dữ
// liệu hỏng hoặc localStorage bị chặn).
const STORAGE_KEY = 'agent-core-ui-sidebar-collapsed'

export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveSidebarCollapsed(collapsed: boolean) {
  localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
}
