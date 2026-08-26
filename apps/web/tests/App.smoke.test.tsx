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
//
// Phase 6.3 (WS downlink-only, gộp vào api-rest): protocol đổi hẳn so với
// Phase 9.4 gốc — tạo session giờ là `POST /sessions` (REST), không còn gửi
// `create_session` qua WS; WS chỉ mở SAU khi có sessionId thật, chỉ để NHẬN
// step/done/error. `FakeWebSocket` bên dưới vì vậy không còn cần track
// `.sent` cho mục đích assert protocol nữa (client không gửi gì qua WS cả) —
// chỉ cần mô phỏng handshake + cho phép test bắn `emitMessage()` để verify
// applyStep(). fetch được stub theo route (xem `makeFetchMock`) vì
// handleSubmit() giờ đi qua REST thật trước khi mở WS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from '../src/App.tsx'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
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
  close() {
    this.readyState = 3
    for (const cb of this.listeners.close ?? []) cb({ code: 1000 })
  }
  // Giả lập server gửi 1 message WS thật — dùng để test applyStep() với các
  // step type RLM phát (tool_call/code/...), xem tests bên dưới.
  emitMessage(payload: unknown) {
    for (const cb of this.listeners.message ?? []) cb({ data: JSON.stringify(payload) })
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// Router tối giản cho các route App.tsx thật sự gọi trong luồng gửi tin nhắn
// đầu tiên (mount -> /skills + GET /sessions; handleSubmit -> POST /sessions
// -> POST /sessions/:id/messages). Route nào không khớp -> reject êm (App.tsx
// đã tự bắt lỗi network ở mọi nơi gọi fetch, không throw ra ngoài).
function makeFetchMock() {
  let sessionCounter = 0
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url))
    const method = init?.method ?? 'GET'
    if (method === 'GET' && u.pathname === '/skills') return jsonResponse({ skills: [] })
    if (method === 'GET' && u.pathname === '/sessions') return jsonResponse({ sessions: [] })
    if (method === 'POST' && u.pathname === '/sessions') {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      sessionCounter += 1
      return jsonResponse({ id: `s${sessionCounter}`, driver: body.driver ?? 'default', maxSteps: 8 }, 201)
    }
    if (method === 'POST' && /^\/sessions\/[^/]+\/messages$/.test(u.pathname)) {
      return jsonResponse({ content: '', steps: 0 })
    }
    throw new Error(`unhandled fetch trong test: ${method} ${url}`)
  })
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
    localStorage.setItem('agent-core-ui-settings', JSON.stringify({ restUrl: 'http://localhost:8787', wsUrl: 'ws://localhost:8787' }))
    // GET /sessions + /skills gọi lúc mount (đã đăng nhập) — không có server
    // thật lắng nghe trong test này, fetch thật sẽ reject; App phải xử lý êm
    // (toast lỗi, KHÔNG throw) — đúng điều cần verify, không mock fetch ở đây.

    await act(async () => {
      render(<App />)
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(screen.queryByRole('heading', { name: 'Đăng nhập' })).toBeNull()
    expect(screen.getByText('alice')).toBeTruthy()
  })

  // docs/agent-core-rlm-web-ui-plugin-plan.md mục 6, case 5 — cập nhật cho
  // Phase 6.3: tạo session giờ qua REST, WS chỉ mở SAU khi có id thật.
  describe('luồng gửi tin nhắn đầu tiên (REST tạo session, WS chỉ subscribe)', () => {
    let fetchMock: ReturnType<typeof makeFetchMock>

    beforeEach(() => {
      FakeWebSocket.instances = []
      vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
      localStorage.setItem(
        'agent-core-ui-auth',
        JSON.stringify({ token: 'fake-token-for-smoke-test', user: { id: 'u1', username: 'alice', role: 'admin' } }),
      )
      localStorage.setItem('agent-core-ui-settings', JSON.stringify({ restUrl: 'http://localhost:8787', wsUrl: 'ws://localhost:8787' }))
      fetchMock = makeFetchMock()
      vi.stubGlobal('fetch', fetchMock)
    })

    function postSessionCalls() {
      return fetchMock.mock.calls.filter(([url, init]) => new URL(String(url)).pathname === '/sessions' && init?.method === 'POST')
    }

    // Follow-up (2026-08), vẫn đúng ở Phase 6.3: bug thật user báo — mở
    // app/bấm "Chat mới" xong F5 TRƯỚC KHI gõ gì vẫn tự lưu 1 session rỗng
    // vào history. Nguyên nhân gốc (create_session gửi ngay lúc mount) đã
    // đổi cơ chế (giờ là POST /sessions), nhưng bất biến cần giữ vẫn vậy:
    // chưa gõ gì thì CHƯA được tạo session nào cả.
    it('mount KHÔNG tự tạo session nào — chưa gõ gì thì chưa có POST /sessions nào cả', async () => {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })

      expect(postSessionCalls().length).toBe(0)
      expect(FakeWebSocket.instances.length).toBe(0) // chưa có session -> chưa có gì để mở stream
      expect(document.getElementById('workspace-bar')).toBeNull()
      expect(screen.queryByLabelText('Chọn skill')).toBeNull()
    })

    it('gõ + gửi tin nhắn đầu tiên -> POST /sessions (driver "default") rồi mở WS stream cho đúng session đó', async () => {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })

      await act(async () => {
        fireEvent.change(screen.getByPlaceholderText('Nhắn gì đó cho agent...'), { target: { value: 'xin chào' } })
        fireEvent.click(screen.getByText('Gửi'))
        await new Promise((r) => setTimeout(r, 30))
      })

      const createCalls = postSessionCalls()
      expect(createCalls.length).toBe(1)
      expect(JSON.parse(String(createCalls[0][1]?.body))).toMatchObject({ driver: 'default' })

      expect(FakeWebSocket.instances.length).toBe(1)
      expect(FakeWebSocket.instances[0].url).toContain('/sessions/s1/events/stream')

      const messageCalls = fetchMock.mock.calls.filter(([url]) => /\/sessions\/[^/]+\/messages$/.test(String(url)))
      expect(messageCalls.length).toBe(1)
      expect(JSON.parse(String(messageCalls[0][1]?.body))).toMatchObject({ message: 'xin chào' })
    })

    it('bấm "Phân tích dữ liệu" trong Sidebar -> gõ + gửi tin đầu tiên mới tạo session, đúng driver "rlm"', async () => {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })

      await act(async () => {
        fireEvent.click(screen.getByText('Phân tích dữ liệu'))
        await new Promise((r) => setTimeout(r, 10))
      })

      expect(postSessionCalls().length).toBe(0) // bấm nút chưa gửi gì, chỉ chọn driver cho session SẼ tạo

      await act(async () => {
        fireEvent.change(screen.getByPlaceholderText('Nhắn gì đó cho agent...'), { target: { value: 'phân tích dữ liệu này' } })
        fireEvent.click(screen.getByText('Gửi'))
        await new Promise((r) => setTimeout(r, 30))
      })

      const createCalls = postSessionCalls()
      expect(createCalls.length).toBe(1)
      expect(JSON.parse(String(createCalls[0][1]?.body))).toMatchObject({ driver: 'rlm' })
    })

    // Helper dùng chung cho 3 test render step bên dưới — gửi 1 tin nhắn để
    // đi qua đúng luồng thật (POST /sessions -> mở WS) rồi trả về socket giả
    // lập để bắn step như server thật sẽ làm.
    async function createSessionAndGetSocket() {
      await act(async () => {
        render(<App />)
        await new Promise((r) => setTimeout(r, 30))
      })
      await act(async () => {
        fireEvent.change(screen.getByPlaceholderText('Nhắn gì đó cho agent...'), { target: { value: 'bắt đầu' } })
        fireEvent.click(screen.getByText('Gửi'))
        await new Promise((r) => setTimeout(r, 30))
      })
      return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    }

    // Gap thật user báo lại: loop-rlm phát step 'tool_call' RIÊNG (không
    // lồng trong `toolCall` như model_message của loop-default) — trước khi
    // sửa applyStep(), card tool không bao giờ được tạo trong lượt RLM nên
    // UI chờ không hiện gì đang chạy, và 'tool_result' theo sau cũng rơi.
    it("step 'tool_call' (RLM) -> hiện card tool đang chạy; 'tool_result' theo sau hoàn tất đúng card đó", async () => {
      const socket = await createSessionAndGetSocket()

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
      const socket = await createSessionAndGetSocket()

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'code', code: 'print(1)' } })
        await new Promise((r) => setTimeout(r, 10))
      })

      expect(screen.getByText('💻 đang chạy code…')).toBeTruthy()
    })

    // Đối chiếu dsh (WebBlock)/Claude: lúc tool ĐANG chạy, hiện ngay câu tìm
    // kiếm thật (người đọc được) thay vì JSON kỹ thuật thô `{"query":"..."}`.
    it('tool_call có toolUi.summaryArg -> hiện query dạng trích dẫn, không phải raw JSON', async () => {
      const socket = await createSessionAndGetSocket()

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

    // Follow-up (2026-08): user báo kết quả search bị ẩn ngay sau khi trả
    // lời xong (ToolRow collapsed-by-default áp dụng cho MỌI tool trước
    // đây) — verify đúng chỗ NỐI trong App.tsx: tool có toolUi.render ===
    // 'citations' (web_search) tự mở ngay khi 'ok', không cần bấm gì cả.
    it("web_search 'ok' (render: citations) -> nguồn hiện NGAY, không cần bấm mở rộng", async () => {
      const socket = await createSessionAndGetSocket()
      const toolUi = { icon: '🔍', label: 'Tìm kiếm web', render: 'citations' as const, summaryArg: 'query' }

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'tool_call', name: 'web_search', args: { query: 'x' }, toolUi } })
        await new Promise((r) => setTimeout(r, 5))
      })
      await act(async () => {
        socket.emitMessage({
          type: 'step',
          sessionId: 's1',
          step: { type: 'tool_result', name: 'web_search', result: { results: [{ title: 'Báo Dân Trí', url: 'https://dantri.com.vn' }] }, toolUi },
        })
        await new Promise((r) => setTimeout(r, 10))
      })

      // Không bấm gì cả — nguồn phải hiện sẵn.
      expect(screen.getByText('Báo Dân Trí')).toBeTruthy()
    })

    // Follow-up (2026-08) — streaming: user báo chưa thấy trả lời "gõ từng
    // chữ". Step 'token' mới (backend phát khi provider hỗ trợ SSE, xem
    // seams/llm.ts + loop-default) -- verify applyStep() ghép đúng 1 bubble
    // DUY NHẤT từ nhiều mảnh nhỏ, và 'final' theo sau KHÔNG tạo bubble lặp.
    it("step 'token' liên tiếp -> ghép thành 1 bubble assistant DUY NHẤT, tăng dần theo từng mảnh", async () => {
      const socket = await createSessionAndGetSocket()

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'token', content: 'xin' } })
        await new Promise((r) => setTimeout(r, 5))
      })
      expect(screen.getByText('xin')).toBeTruthy()

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'token', content: ' chào' } })
        await new Promise((r) => setTimeout(r, 5))
      })
      // Vẫn 1 bubble duy nhất, nội dung đã ghép nối tiếp — không phải 2 bubble riêng.
      expect(screen.getByText('xin chào')).toBeTruthy()
      expect(screen.queryByText('xin')).toBeNull()
    })

    it("'token' rồi 'final' cùng nội dung -> KHÔNG lặp bubble (final chỉ đóng lại bubble đã stream)", async () => {
      const socket = await createSessionAndGetSocket()

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'token', content: 'xin chào bạn' } })
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'model_message', content: 'xin chào bạn' } })
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'final', content: 'xin chào bạn' } })
        await new Promise((r) => setTimeout(r, 10))
      })

      expect(screen.getAllByText('xin chào bạn').length).toBe(1)
    })

    it("KHÔNG có 'token' nào (provider không hỗ trợ streaming) -> 'final' vẫn tự tạo bubble như cũ", async () => {
      const socket = await createSessionAndGetSocket()

      await act(async () => {
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'model_message', content: 'câu trả lời không stream' } })
        socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'final', content: 'câu trả lời không stream' } })
        await new Promise((r) => setTimeout(r, 10))
      })

      expect(screen.getByText('câu trả lời không stream')).toBeTruthy()
    })
  })
})
