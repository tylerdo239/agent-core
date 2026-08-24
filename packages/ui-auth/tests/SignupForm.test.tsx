// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SignupForm } from '../src/SignupForm.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SignupForm', () => {
  it('mật khẩu nhập lại KHÔNG khớp -> hiện lỗi phía client, KHÔNG gọi fetch', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<SignupForm restUrl="http://localhost:8787" onSuccess={vi.fn()} onSwitchToLogin={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'bob' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'correcthorse123' } })
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), { target: { value: 'khac-mat-khau' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký' }))

    expect(screen.getByText('Mật khẩu nhập lại không khớp')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mật khẩu khớp -> POST /auth/signup, thành công gọi onSuccess', async () => {
    const authResult = { token: 'tok-2', user: { id: 'u2', username: 'bob', role: 'user' } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => authResult })
    vi.stubGlobal('fetch', fetchMock)
    const onSuccess = vi.fn()

    render(<SignupForm restUrl="http://localhost:8787" onSuccess={onSuccess} onSwitchToLogin={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'bob' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'correcthorse123' } })
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), { target: { value: 'correcthorse123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(authResult))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/auth/signup',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ username: 'bob', password: 'correcthorse123' }) }),
    )
  })

  it('bấm "Đăng nhập" -> gọi onSwitchToLogin', () => {
    const onSwitchToLogin = vi.fn()
    render(<SignupForm restUrl="http://localhost:8787" onSuccess={vi.fn()} onSwitchToLogin={onSwitchToLogin} />)
    fireEvent.click(screen.getByText('Đăng nhập'))
    expect(onSwitchToLogin).toHaveBeenCalled()
  })
})
