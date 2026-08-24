// @vitest-environment jsdom
//
// Verify THẬT LoginForm — mock global.fetch chỉ để khẳng định đúng request
// shape gửi đi + xử lý response thật (thành công gọi onSuccess, thất bại
// hiện lỗi ngay trong form) — không mock React/component nào khác.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LoginForm } from '../src/LoginForm.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LoginForm', () => {
  it('submit đúng username/password -> POST /auth/login đúng body, thành công gọi onSuccess', async () => {
    const authResult = { token: 'tok-1', user: { id: 'u1', username: 'alice', role: 'admin' } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => authResult })
    vi.stubGlobal('fetch', fetchMock)
    const onSuccess = vi.fn()

    render(<LoginForm restUrl="http://localhost:8787" onSuccess={onSuccess} onSwitchToSignup={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'correcthorse123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(authResult))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correcthorse123' }) }),
    )
  })

  it('sai mật khẩu -> hiện lỗi NGAY TRONG form, KHÔNG gọi onSuccess', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'sai tên đăng nhập hoặc mật khẩu' }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSuccess = vi.fn()

    render(<LoginForm restUrl="http://localhost:8787" onSuccess={onSuccess} onSwitchToSignup={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'sai-mat-khau' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    await waitFor(() => expect(screen.getByText('sai tên đăng nhập hoặc mật khẩu')).toBeTruthy())
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('bấm "Đăng ký" -> gọi onSwitchToSignup', () => {
    const onSwitchToSignup = vi.fn()
    render(<LoginForm restUrl="http://localhost:8787" onSuccess={vi.fn()} onSwitchToSignup={onSwitchToSignup} />)
    fireEvent.click(screen.getByText('Đăng ký'))
    expect(onSwitchToSignup).toHaveBeenCalled()
  })
})
