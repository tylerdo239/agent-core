// packages/ui-auth/src/SignupForm.tsx — cùng hình dạng với LoginForm.tsx,
// thêm 1 field "nhập lại mật khẩu" + check khớp phía CLIENT (server không
// biết/không cần biết về "confirm password", chỉ nhận đúng 1 password) —
// UX sớm, không phải bảo mật (server tự validate độ dài >=8 ký tự lúc signup).
import { useState, type FormEvent } from 'react'
import { Button, TextField } from '@agent-core/ui-primitives'
import { signup } from './authApi.ts'
import type { AuthState } from './authState.ts'
import styles from './SignupForm.module.css'

export interface SignupFormProps {
  restUrl: string
  onSuccess: (result: AuthState) => void
  onSwitchToLogin: () => void
}

export function SignupForm({ restUrl, onSuccess, onSwitchToLogin }: SignupFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError('Mật khẩu nhập lại không khớp')
      return
    }
    setError(undefined)
    setSubmitting(true)
    try {
      const result = await signup(restUrl, username, password)
      onSuccess(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'đăng ký thất bại')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Đăng ký</h1>
        <TextField label="Tên đăng nhập" value={username} onChange={setUsername} autoComplete="username" required />
        <TextField label="Mật khẩu" type="password" value={password} onChange={setPassword} autoComplete="new-password" required />
        <TextField
          label="Nhập lại mật khẩu"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          required
        />
        {error && <p className={styles.error}>{error}</p>}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Đang đăng ký...' : 'Đăng ký'}
        </Button>
        <p className={styles.switch}>
          Đã có tài khoản?{' '}
          <button type="button" className={styles.link} onClick={onSwitchToLogin}>
            Đăng nhập
          </button>
        </p>
      </form>
    </div>
  )
}
