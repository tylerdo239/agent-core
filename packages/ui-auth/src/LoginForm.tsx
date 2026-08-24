// packages/ui-auth/src/LoginForm.tsx — màn hình đăng nhập, thay thế hẳn màn
// hình chat khi chưa có auth (xem apps/web/src/App.tsx: render LoginForm
// TRƯỚC <AppFrame>, không phải 1 modal đè lên). Lỗi API (sai mật khẩu...)
// hiện NGAY TRONG form (không phải Toast) — user cần thấy lỗi này gắn liền
// với form, khác lỗi kết nối/hệ thống thoáng qua mà Toast đã xử lý ở nơi khác.
import { useState, type FormEvent } from 'react'
import { Button, TextField } from '@agent-core/ui-primitives'
import { login } from './authApi.ts'
import type { AuthState } from './authState.ts'
import styles from './LoginForm.module.css'

export interface LoginFormProps {
  restUrl: string
  onSuccess: (result: AuthState) => void
  onSwitchToSignup: () => void
}

export function LoginForm({ restUrl, onSuccess, onSwitchToSignup }: LoginFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    setSubmitting(true)
    try {
      const result = await login(restUrl, username, password)
      onSuccess(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'đăng nhập thất bại')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Đăng nhập</h1>
        <TextField label="Tên đăng nhập" value={username} onChange={setUsername} autoComplete="username" required />
        <TextField label="Mật khẩu" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        {error && <p className={styles.error}>{error}</p>}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </Button>
        <p className={styles.switch}>
          Chưa có tài khoản?{' '}
          <button type="button" className={styles.link} onClick={onSwitchToSignup}>
            Đăng ký
          </button>
        </p>
      </form>
    </div>
  )
}
