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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App, createSessionCommand } from '../src/App.tsx'

// docs/agent-core-rlm-web-ui-plugin-plan.md mục 6, case 5: verify WS THẬT
// nhận đúng driver — jsdom's WebSocket thật không có server nào lắng nghe
// (existing test comment), nên các case cũ không cần biết nó gửi gì. Case
// mới ở đây CẦN biết -> stub tối giản, tự bắn 'open' ngay sau khi tạo
// (đủ để trigger đúng nhánh gửi 'create_session' trong App.tsx's connect()).
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, Array<(event: unknown) => void>> = {}
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
    setTimeout(() => {
      this.readyState = 1
      for (const cb of this.listeners.open ?? []) cb({})
    }, 0)
  }
  addEventListener(type: string, cb: (event: unknown) => void) {
    ;(this.listeners[type] ??= []).push(cb)
  }
  removeEventListener() {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
}

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
  // docs/agent-core-rlm-web-ui-plugin-plan.md: mặc định quay về 'default' —
  // RLM không còn là driver CỐ ĐỊNH cho MỌI session nữa (bản trước Phase
  // này khẳng định ngược lại, đã lỗi thời — xem mục 3 doc trên).
  it('session mới mặc định dùng driver "default" (RLM là lựa chọn chủ động, không phải mặc định)', () => {
    expect(createSessionCommand()).toMatchObject({ type: 'create_session', driver: 'default' })
    expect(createSessionCommand('rlm')).toMatchObject({ type: 'create_session', driver: 'rlm' })
  })

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

  // docs/agent-core-rlm-web-ui-plugin-plan.md mục 6, case 5.
  describe('entry point RLM (WS thật, stub tối giản — xem FakeWebSocket đầu file)', () => {
    beforeEach(() => {
      FakeWebSocket.instances = []
      vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
      localStorage.setItem(
        'agent-core-ui-auth',
        JSON.stringify({ token: 'fake-token-for-smoke-test', user: { id: 'u1', username: 'alice', role: 'admin' } }),
      )
      localStorage.setItem('agent-core-ui-settings', JSON.stringify({ restUrl: 'http://localhost:8787', wsUrl: 'ws://localhost:8788' }))
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no server in test env')))
    })

    it('phiên mặc định lúc mount gửi driver "default" -> KHÔNG hiện workspace bar (session.chrome.header rơi về fallback null)', async () => {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })

      const socket = FakeWebSocket.instances[0]
      expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'create_session', driver: 'default' })
      expect(document.getElementById('workspace-bar')).toBeNull()
      expect(screen.queryByLabelText('Chọn skill')).toBeNull()
    })

    it('bấm "Phân tích dữ liệu" trong Sidebar -> mở kết nối MỚI, gửi create_session với driver "rlm"', async () => {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })

      await act(async () => {
        fireEvent.click(screen.getByText('Phân tích dữ liệu'))
        await new Promise((r) => setTimeout(r, 30))
      })

      const latestSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      expect(JSON.parse(latestSocket.sent[0])).toMatchObject({ type: 'create_session', driver: 'rlm' })
    })
  })
})
