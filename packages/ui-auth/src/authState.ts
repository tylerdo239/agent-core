// packages/ui-auth/src/authState.ts — cache token+user hiện tại ở
// localStorage, cùng pattern load/save đã có ở packages/ui-settings-general/
// src/settings.ts (try/catch JSON.parse, hỏng -> coi như chưa đăng nhập,
// không throw). KHÁC settings.ts: không có defaultAuthState() vì "chưa
// đăng nhập" hợp lệ là `null`, không phải 1 object rỗng.
export type Role = 'admin' | 'user'

export interface AuthUser {
  id: string
  username: string
  role: Role
}

export interface AuthState {
  token: string
  user: AuthUser
}

const STORAGE_KEY = 'agent-core-ui-auth'

export function loadAuthState(): AuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.token !== 'string' || !parsed.user) return null
    return parsed as AuthState
  } catch {
    return null
  }
}

export function saveAuthState(state: AuthState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearAuthState() {
  localStorage.removeItem(STORAGE_KEY)
}
