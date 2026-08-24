// packages/ui-auth/src/authApi.ts — fetch wrapper thẳng tới REST thật
// (bundles/adapters/api-rest) — 6 lệnh gọi khác nhau cùng chia sẻ logic xử
// lý lỗi (đọc {error} từ body, throw Error với message thật thay vì mã lỗi
// trần) nên gom vào 1 file dùng chung, khác SettingsForm.tsx (chỉ có logic
// thuần localStorage, không cần lớp fetch riêng).
import type { AuthState, AuthUser, Role } from './authState.ts'

export interface UserRecord {
  id: string
  username: string
  role: Role
  active: boolean
  createdAt: number
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') return body.error
  } catch {
    // body không phải JSON hợp lệ -- rơi xuống message chung bên dưới.
  }
  return `lỗi ${res.status}`
}

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function signup(restUrl: string, username: string, password: string): Promise<AuthState> {
  return postJson<AuthState>(`${restUrl}/auth/signup`, { username, password })
}

export async function login(restUrl: string, username: string, password: string): Promise<AuthState> {
  return postJson<AuthState>(`${restUrl}/auth/login`, { username, password })
}

export async function logout(restUrl: string, token: string): Promise<void> {
  await postJson<void>(`${restUrl}/auth/logout`, {}, token)
}

export interface SessionSummary {
  id: string
  driver: string
  maxSteps: number
  createdAt: number
}

export async function listSessions(restUrl: string, token: string): Promise<SessionSummary[]> {
  const res = await fetch(`${restUrl}/sessions`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  const { sessions } = (await res.json()) as { sessions: SessionSummary[] }
  return sessions
}

export async function listUsers(restUrl: string, token: string): Promise<UserRecord[]> {
  const res = await fetch(`${restUrl}/users`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  const { users } = (await res.json()) as { users: UserRecord[] }
  return users
}

export async function updateUser(
  restUrl: string,
  token: string,
  id: string,
  patch: { role?: Role; active?: boolean },
): Promise<UserRecord> {
  const res = await fetch(`${restUrl}/users/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  const { user } = (await res.json()) as { user: UserRecord }
  return user
}

export async function deleteUser(restUrl: string, token: string, id: string): Promise<void> {
  const res = await fetch(`${restUrl}/users/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export type { AuthState, AuthUser, Role }
