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
  // Giả lập server gửi 1 message WS thật — dùng để test applyStep() với các
  // step type RLM phát (tool_call/code/...), xem tests bên dưới.
  emitMessage(payload: unknown) {
    for (const cb of this.listeners.message ?? []) cb({ data: JSON.stringify(payload) })
  }
  emit(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event)
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

    // Gap thật user báo lại: loop-rlm phát step 'tool_call' RIÊNG (không
    // lồng trong `toolCall` như model_message của loop-default) — trước khi
    // sửa applyStep(), card tool không bao giờ được tạo trong lượt RLM nên
    // UI chờ không hiện gì đang chạy, và 'tool_result' theo sau cũng rơi.
    it("step 'tool_call' (RLM) -> hiện card tool đang chạy; 'tool_result' theo sau hoàn tất đúng card đó", async () => {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })
      const socket = FakeWebSocket.instances[0]

      await act(async () => {
        socket.emitMessage({ type: 'session_created', id: 's1', driver: 'rlm' })
        await new Promise((r) => setTimeout(r, 10))
      })

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'tool_call', name: 'web_search', args: { query: 'x' } } })
        await new Promise((r) => setTimeout(r, 10))
      })

      expect(screen.getByText('web_search').closest('[data-state]')?.getAttribute('data-state')).toBe('running')

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'tool_result', name: 'web_search', result: { ok: true } } })
        await new Promise((r) => setTimeout(r, 10))
      })

      expect(screen.getByText('web_search').closest('[data-state]')?.getAttribute('data-state')).toBe('ok')
    })

    it("step 'code' (RLM, đang chạy REPL giữa các tool call) -> hiện chỉ báo hoạt động, không màn hình trắng chờ 'final'", async () => {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })
      const socket = FakeWebSocket.instances[0]

      await act(async () => {
        socket.emitMessage({ type: 'session_created', id: 's1', driver: 'rlm' })
        await new Promise((r) => setTimeout(r, 10))
      })

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'code', code: 'print(1)' } })
        await new Promise((r) => setTimeout(r, 10))
      })

      expect(screen.getByText('💻 đang chạy code…')).toBeTruthy()
    })

    // Đối chiếu dsh (WebBlock)/Claude: lúc tool ĐANG chạy, hiện ngay câu tìm
    // kiếm thật (người đọc được) thay vì JSON kỹ thuật thô `{"query":"..."}`.
    it("tool_call có toolUi.summaryArg -> hiện query dạng trích dẫn, không phải raw JSON", async () => {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })
      const socket = FakeWebSocket.instances[0]

      await act(async () => {
        socket.emitMessage({ type: 'session_created', id: 's1', driver: 'rlm' })
        await new Promise((r) => setTimeout(r, 10))
      })

      await act(async () => {
        socket.emitMessage({
          type: 'step',
          sessionId: 's1',
          step: {
            type: 'tool_call',
            name: 'web_search',
            args: { query: 'Vietnam coffee market size' },
            toolUi: { icon: '🔍', label: 'Tìm kiếm web', render: 'citations', summaryArg: 'query' },
          },
        })
        await new Promise((r) => setTimeout(r, 10))
      })

      expect(screen.getByText('"Vietnam coffee market size"')).toBeTruthy()
      expect(screen.queryByText('{"query":"Vietnam coffee market size"}')).toBeNull()
    })

    it('reload mở lại session gần nhất và dựng timeline từ event log thay vì tạo session trắng', async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/sessions')) {
          return { ok: true, json: async () => ({ sessions: [{ id: 'saved-rlm', createdAt: 10, driver: 'rlm' }] }) } as Response
        }
        if (url.endsWith('/sessions/saved-rlm/events')) {
          return {
            ok: true,
            json: async () => ({ events: [
              { type: 'analysis', content: 'Đang kiểm tra dữ liệu đã lưu' },
              { type: 'workspace_read', action: 'list datasets' },
              { type: 'final_answer', content: 'Đã hoàn thành' },
            ] }),
          } as Response
        }
        if (url.endsWith('/skills')) return { ok: true, json: async () => ({ skills: [] }) } as Response
        throw new Error(`unexpected URL: ${url}`)
      }))

      await act(async () => {
        render(<App />)
        await new Promise((resolve) => setTimeout(resolve, 40))
      })

      expect(screen.getByText('Đang kiểm tra dữ liệu đã lưu')).toBeTruthy()
      expect(screen.getByText('📄 list datasets')).toBeTruthy()
      expect(screen.getByText('Đã hoàn thành')).toBeTruthy()
      expect(FakeWebSocket.instances[0].sent).toHaveLength(0)
    })

    it('giữ nguyên timeline live sau done và tiếp tục hiện step của request sau', async () => {
      await act(async () => {
        render(<App />)
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      const socket = FakeWebSocket.instances[0]

      await act(async () => {
        socket.emit('message', { data: JSON.stringify({ type: 'session_created', id: 'live-rlm', driver: 'rlm' }) })
        socket.emit('message', { data: JSON.stringify({ type: 'step', step: { type: 'analysis', content: 'Đang phân tích request 1' } }) })
        socket.emit('message', { data: JSON.stringify({ type: 'done', sessionId: 'live-rlm', result: {} }) })
      })
      expect(screen.getByText('Đang phân tích request 1')).toBeTruthy()

      await act(async () => {
        socket.emit('message', { data: JSON.stringify({ type: 'step', step: { type: 'workspace_read', action: 'load dataset', path: 'sales' } }) })
      })
      expect(screen.getByText('📄 load dataset')).toBeTruthy()
      expect(screen.queryByText('🐍 Python REPL')).toBeNull()
      expect(screen.queryByText('✅ Kết quả REPL')).toBeNull()
    })
  })
})
