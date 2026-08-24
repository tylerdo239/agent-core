// @vitest-environment jsdom
//
// AdminUsersPanel bọc Modal (<dialog> thật) -- cùng giới hạn môi trường test
// đã gặp khắp nơi trong repo: jsdom không implement showModal()/close().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AdminUsersPanel } from '../src/AdminUsersPanel.tsx'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const users = [
  { id: 'u1', username: 'alice', role: 'admin', active: true, createdAt: 1 },
  { id: 'u2', username: 'bob', role: 'user', active: true, createdAt: 2 },
]

describe('AdminUsersPanel', () => {
  it('mở panel -> gọi GET /users, render đúng danh sách', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ users }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<AdminUsersPanel open restUrl="http://localhost:8787" token="tok" currentUserId="u1" onClose={vi.fn()} />)
    })

    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy())
    expect(screen.getByText('bob')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/users', { headers: { authorization: 'Bearer tok' } })
  })

  it('hàng của CHÍNH user đang đăng nhập -> nút thao tác bị disable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ users }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<AdminUsersPanel open restUrl="http://localhost:8787" token="tok" currentUserId="u1" onClose={vi.fn()} />)
    })
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy())

    const aliceRow = screen.getByText('alice').closest('tr')!
    for (const btn of aliceRow.querySelectorAll('button')) expect((btn as HTMLButtonElement).disabled).toBe(true)

    const bobRow = screen.getByText('bob').closest('tr')!
    for (const btn of bobRow.querySelectorAll('button')) expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it('bấm "Cấp admin" cho user khác -> PATCH /users/:id, cập nhật đúng dòng', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === 'http://localhost:8787/users') return Promise.resolve({ ok: true, status: 200, json: async () => ({ users }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ user: { ...users[1], role: 'admin' } }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<AdminUsersPanel open restUrl="http://localhost:8787" token="tok" currentUserId="u1" onClose={vi.fn()} />)
    })
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy())

    const bobRow = screen.getByText('bob').closest('tr')!
    fireEvent.click(within(bobRow).getByText('Cấp admin'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/users/u2',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'admin' }) }),
      ),
    )
  })

  it('bấm "Xoá" -> DELETE /users/:id, dòng biến mất', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === 'http://localhost:8787/users') return Promise.resolve({ ok: true, status: 200, json: async () => ({ users }) })
      if (init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: async () => ({}) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<AdminUsersPanel open restUrl="http://localhost:8787" token="tok" currentUserId="u1" onClose={vi.fn()} />)
    })
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy())

    const bobRow = screen.getByText('bob').closest('tr')!
    fireEvent.click(within(bobRow).getByText('Xoá'))

    await waitFor(() => expect(screen.queryByText('bob')).toBeNull())
  })
})
