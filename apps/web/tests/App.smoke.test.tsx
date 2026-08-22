// @vitest-environment jsdom
//
// Phase 9.4 smoke test: render <App/> THẬT trong jsdom (không mock React,
// không mock Cordis) — verify toàn bộ dây chuyền async thật sự chạy được:
// createClientContext() (mount ctx.slots, await fiber.await()) resolve
// đúng, App không throw.
//
// Module auth (nhiều người dùng thật, 2026-08): hành vi "chưa có gì -> mở
// settings dialog" đã lỗi thời (API key không còn tồn tại) — thay bằng
// "chưa đăng nhập -> hiện LoginForm" / "đã có auth state -> vào thẳng khung
// chat (không hiện LoginForm)".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { App } from '../src/App.tsx'

// jsdom tạo đúng HTMLDialogElement cho thẻ <dialog> nhưng KHÔNG implement
// showModal()/close() (hỗ trợ 1 phần spec Dialog) -- cùng lý do như
// scrollIntoView bên dưới: đây là giới hạn môi trường test, mọi trình duyệt
// thật đều có đủ 2 method này.
beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
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

describe('Phase 9.4 — App smoke test', () => {
  it('render không throw; chưa đăng nhập -> hiện LoginForm', async () => {
    await act(async () => {
      render(<App />)
      // Chờ createClientContext() (async thật, mount ctx.slots qua Cordis) resolve.
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeTruthy()
  })

  it('có auth state sẵn trong localStorage -> KHÔNG hiện LoginForm, vào thẳng khung chat', async () => {
    localStorage.setItem(
      'agent-core-ui-auth',
      JSON.stringify({ token: 'fake-token-for-smoke-test', user: { id: 'u1', username: 'alice', role: 'admin' } }),
    )
    localStorage.setItem('agent-core-ui-settings', JSON.stringify({ restUrl: 'http://localhost:8787', wsUrl: 'ws://localhost:8788' }))
    // GET /sessions gọi lúc mount (đã đăng nhập) — không có server thật lắng
    // nghe trong test này, fetch thật sẽ reject; App phải xử lý êm (toast lỗi,
    // KHÔNG throw) — đúng điều cần verify, không mock fetch ở đây.

    // jsdom có WebSocket thật (thử connect thật tới ws://localhost:8788) —
    // không có server nào lắng nghe cổng đó trong test này nên sẽ tự
    // fail/close, nhưng KHÔNG được làm render() throw — đúng điều cần verify.
    await act(async () => {
      render(<App />)
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(screen.queryByRole('heading', { name: 'Đăng nhập' })).toBeNull()
    expect(screen.getByText('alice')).toBeTruthy()
  })
})
