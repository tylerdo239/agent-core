// packages/ui-settings-general/src/settings.ts — Phase 9.4: port nguyên
// logic settings từ bundles/adapters/web-ui/public/app.js (Phase 7), không
// đổi hành vi. Chuyển vào package riêng ở phase restructure UI mirror dsh
// (packages/client/ui-settings-general) — vẫn nguyên logic, chỉ đổi vị trí.
//
// Module auth (nhiều người dùng thật): `apiKey` đã bị XOÁ khỏi Settings —
// danh tính giờ là tài khoản thật (username/password -> token), sống ở
// packages/ui-auth/src/authState.ts (localStorage key riêng), không còn
// trộn chung với cấu hình URL kết nối ở đây nữa.
export interface Settings {
  restUrl: string
  wsUrl: string
}

const STORAGE_KEY = 'agent-core-ui-settings'

export function defaultSettings(): Settings {
  const proto = location.protocol === 'https:' ? 'https:' : 'http:'
  const wsProto = proto === 'https:' ? 'wss:' : 'ws:'
  return {
    restUrl: `${proto}//${location.hostname}:8787`,
    wsUrl: `${wsProto}//${location.hostname}:8788`,
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    return { ...defaultSettings(), ...JSON.parse(raw) }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
