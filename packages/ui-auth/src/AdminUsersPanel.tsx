// packages/ui-auth/src/AdminUsersPanel.tsx — bọc Modal sẵn có (packages/
// ui-primitives) với className rộng hơn (Modal đã hỗ trợ prop này từ phase
// SearchModal — không cần router, SPA này không có router nào cả). Server
// đã tự chặn "xoá/hạ quyền/khoá admin cuối cùng" (assertNotLastAdmin,
// bundles/providers/auth-users) — disable nút thao tác lên CHÍNH mình ở
// đây chỉ là UX chặn sớm, KHÔNG phải ranh giới bảo mật thật (ranh giới thật
// nằm ở server, verify độc lập với UI này).
import { useEffect, useState } from 'react'
import { Button, Modal, Pill, Skeleton } from '@agent-core/ui-primitives'
import { deleteUser, listUsers, updateUser, type UserRecord } from './authApi.ts'
import styles from './AdminUsersPanel.module.css'

export interface AdminUsersPanelProps {
  open: boolean
  onClose: () => void
  restUrl: string
  token: string
  currentUserId: string
}

export function AdminUsersPanel({ open, onClose, restUrl, token, currentUserId }: AdminUsersPanelProps) {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(undefined)
    listUsers(restUrl, token)
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : 'không tải được danh sách người dùng'))
      .finally(() => setLoading(false))
  }, [open, restUrl, token])

  async function handleToggleRole(user: UserRecord) {
    try {
      const updated = await updateUser(restUrl, token, user.id, { role: user.role === 'admin' ? 'user' : 'admin' })
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'không đổi được vai trò')
    }
  }

  async function handleToggleActive(user: UserRecord) {
    try {
      const updated = await updateUser(restUrl, token, user.id, { active: !user.active })
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'không đổi được trạng thái')
    }
  }

  async function handleDelete(user: UserRecord) {
    try {
      await deleteUser(restUrl, token, user.id)
      setUsers((prev) => prev.filter((u) => u.id !== user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'không xoá được người dùng')
    }
  }

  return (
    <Modal open={open} onClose={onClose} className={styles.wideDialog}>
      <div className={styles.wrap}>
        <h2 className={styles.title}>Quản lý người dùng</h2>
        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <Skeleton rows={3} />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tên đăng nhập</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUserId
                return (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>
                      <Pill tone={u.role === 'admin' ? 'accent' : 'neutral'}>{u.role}</Pill>
                    </td>
                    <td>
                      <Pill tone={u.active ? 'success' : 'error'}>{u.active ? 'active' : 'đã khoá'}</Pill>
                    </td>
                    <td className={styles.actions}>
                      <Button type="button" size="sm" onClick={() => handleToggleRole(u)} disabled={isSelf}>
                        {u.role === 'admin' ? 'Hạ quyền' : 'Cấp admin'}
                      </Button>
                      <Button type="button" size="sm" onClick={() => handleToggleActive(u)} disabled={isSelf}>
                        {u.active ? 'Khoá' : 'Mở khoá'}
                      </Button>
                      <Button type="button" size="sm" onClick={() => handleDelete(u)} disabled={isSelf}>
                        Xoá
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className={styles.dialogActions}>
          <Button type="button" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </Modal>
  )
}
