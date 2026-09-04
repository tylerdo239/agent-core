// @vitest-environment jsdom
// Ma trận UI exhaustive: mọi LoopStep qua applyStep (live WS) + reconstructItems
// (resume qua REST) + WS protocol biên (malformed/unknown/401) + resume biên.
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
  close(code = 1000) {
    this.readyState = 3
    for (const cb of this.listeners.close ?? []) cb({ code })
  }
  emitMessage(payload: unknown) {
    for (const cb of this.listeners.message ?? []) cb({ data: JSON.stringify(payload) })
  }
  emitRaw(data: unknown) {
    for (const cb of this.listeners.message ?? []) cb({ data })
  }
  emit(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event)
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function loginEnv() {
  localStorage.setItem(
    'agent-core-ui-auth',
    JSON.stringify({ token: 'tok-ui-matrix', user: { id: 'u1', username: 'alice', role: 'admin' } }),
  )
  localStorage.setItem('agent-core-ui-settings', JSON.stringify({ restUrl: 'http://localhost:8787', wsUrl: 'ws://localhost:8787' }))
}

function baseFetchMock() {
  let n = 0
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url))
    const method = init?.method ?? 'GET'
    if (method === 'GET' && u.pathname === '/skills') return jsonResponse({ skills: [] })
    if (method === 'GET' && u.pathname === '/sessions') return jsonResponse({ sessions: [] })
    if (method === 'POST' && u.pathname === '/sessions') {
      n += 1
      return jsonResponse({ id: `s${n}`, driver: 'default', maxSteps: 8 }, 201)
    }
    if (method === 'POST' && /^\/sessions\/[^/]+\/messages$/.test(u.pathname)) return jsonResponse({ content: '', steps: 0 })
    return new Response(null, { status: 404 })
  })
}

beforeEach(() => {
  localStorage.clear()
  FakeWebSocket.instances = []
  Element.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function bootLive() {
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
  loginEnv()
  vi.stubGlobal('fetch', baseFetchMock())
  await act(async () => {
    render(<App />)
    await new Promise((r) => setTimeout(r, 30))
  })
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText('Nhắn gì đó cho agent...'), { target: { value: 'bắt đầu' } })
    fireEvent.click(screen.getByText('Gửi'))
    await new Promise((r) => setTimeout(r, 30))
  })
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  const step = async (s: unknown) => {
    await act(async () => {
      socket.emitMessage({ type: 'step', sessionId: 's1', step: s })
      await new Promise((r) => setTimeout(r, 10))
    })
  }
  return { socket, step }
}

describe('U1 token streaming biên', () => {
  it('token rỗng/undefined -> bỏ qua, không tạo bubble rác', async () => {
    const { step } = await bootLive()
    await step({ type: 'token', content: '' })
    await step({ type: 'token' })
    expect(screen.getByPlaceholderText('Nhắn gì đó cho agent...')).toBeTruthy() // composer còn đó
    // Không có bubble assistant nào được tạo
    expect(document.body.textContent).not.toContain('undefined')
  })
  it('token unicode + dài (10k) -> 1 bubble duy nhất', async () => {
    const { step } = await bootLive()
    await step({ type: 'token', content: '😀' })
    await step({ type: 'token', content: '中文'.repeat(5000) })
    expect(screen.getByText('😀' + '中文'.repeat(5000))).toBeTruthy()
  })
  it('token sau final (stream đã đóng) -> mở bubble stream mới, không nhét vào bubble cũ', async () => {
    const { step, socket } = await bootLive()
    await step({ type: 'token', content: 'câu một' })
    await step({ type: 'final', content: 'câu một' })
    await step({ type: 'token', content: 'câu hai' })
    expect(screen.getByText('câu một')).toBeTruthy()
    expect(screen.getByText('câu hai')).toBeTruthy()
    socket.emitMessage({ type: 'done', sessionId: 's1' })
  })
})

describe('U2 model_message/tool_call/tool_result', () => {
  it("model_message có toolCall (default loop) -> card running; tool_result lỗi -> state ok + giữ errorText", async () => {
    const { step } = await bootLive()
    await step({ type: 'model_message', content: '', toolCall: { name: 'q', args: { x: 1 } } })
    expect(screen.getByText('q').closest('[data-state]')?.getAttribute('data-state')).toBe('running')
    await step({ type: 'tool_result', name: 'q', result: { error: 'boom-timeout', code: 'TOOL_TIMEOUT' } })
    expect(screen.getByText('q').closest('[data-state]')?.getAttribute('data-state')).toBe('ok') // lỗi tool không đỏ
  })
  it('tool_call thiếu name/args -> default rỗng, không crash', async () => {
    const { step } = await bootLive()
    await step({ type: 'tool_call' })
    await step({ type: 'tool_result', name: '', result: 1 })
    // Không throw là đạt (card có thể hiện tên rỗng)
  })
  it('tool_result không có tool active nào -> bỏ qua êm', async () => {
    const { step } = await bootLive()
    await step({ type: 'tool_result', name: 'lạ', result: { ok: 1 } })
    expect(screen.queryByText('lạ')).toBeNull()
  })
  it('tool_result result null/undefined/số/chuỗi -> chốt card ok, không crash', async () => {
    const { step } = await bootLive()
    for (const result of [null, undefined, 42, 'plain-string', [1, 2]]) {
      await step({ type: 'tool_call', name: 't', args: {} })
      await step({ type: 'tool_result', name: 't', result })
    }
    expect(screen.getAllByText('t').length).toBeGreaterThanOrEqual(4)
  })
  it('2 tool_call liên tiếp (chưa result đã call mới) -> result chốt đúng card mới nhất', async () => {
    const { step } = await bootLive()
    await step({ type: 'tool_call', name: 'first', args: {} })
    await step({ type: 'tool_call', name: 'second', args: {} })
    await step({ type: 'tool_result', name: 'second', result: { ok: 1 } })
    const second = screen.getByText('second').closest('[data-state]')
    expect(second?.getAttribute('data-state')).toBe('ok')
  })
})

describe('U3 critic/activity steps', () => {
  it('code nhiều lần -> nhiều chỉ báo, không dán code Python', async () => {
    const { step } = await bootLive()
    await step({ type: 'code', code: 'print("secret-code-xyz")' })
    await step({ type: 'code', code: 'x=1' })
    expect(screen.getAllByText('💻 đang chạy code…')).toHaveLength(2)
    expect(screen.queryByText('print("secret-code-xyz")')).toBeNull()
  })
  it('critic_message + analysis (có/không content)', async () => {
    const { step } = await bootLive()
    await step({ type: 'critic_message', content: 'cần xem lại' })
    await step({ type: 'analysis', content: 'đang nghĩ sâu' })
    await step({ type: 'analysis' }) // thiếu content -> bỏ qua
    expect(screen.getByText('🔍 Rà soát')).toBeTruthy()
    expect(screen.getByText('🧠 Think')).toBeTruthy()
  })
  it('skill_loaded thiếu skill -> unknown; skill_resource có/không path', async () => {
    const { step } = await bootLive()
    await step({ type: 'skill_loaded' })
    await step({ type: 'skill_resource', skill: 'wf', path: 'refs/a.md' })
    await step({ type: 'skill_resource', skill: 'wf' })
    expect(screen.getByText('📚 Skill')).toBeTruthy()
    expect(screen.getAllByText('📚 Skill resource')).toHaveLength(2)
  })
  it('workspace_read mọi action + workspace_write mọi đuôi file', async () => {
    const { step } = await bootLive()
    for (const a of ['list datasets', 'profile dataset', 'load dataset', 'list files', 'read file', 'đọc']) {
      await step({ type: 'workspace_read', action: a, path: 'f.csv' })
    }
    for (const p of ['o.json', 'r.md', 'd.csv', 'x.pdf', 'noext']) {
      await step({ type: 'workspace_write', path: p })
    }
    expect(screen.getAllByText('💾 ghi output')).toHaveLength(5)
  })
  it('human_decision thiếu control -> câu hỏi mặc định; options rỗng lọc sạch', async () => {
    const { step } = await bootLive()
    await step({ type: 'human_decision' })
    expect(screen.getByText('RLM đang chờ quyết định của bạn.')).toBeTruthy()
    await step({ type: 'human_decision', control: { question: 'Tiếp tục?', options: ['Có', '', '  ', 'Không'] } })
    expect(screen.getByText('Tiếp tục?')).toBeTruthy()
    expect(screen.getByText('Có')).toBeTruthy()
    expect(screen.getByText('Không')).toBeTruthy()
  })
  it('step loại bị bỏ qua (turn_started/iteration_*/subcall/context_usage/memory_updated) -> không thêm item', async () => {
    const { step } = await bootLive()
    const before = document.body.textContent?.length ?? 0
    for (const s of [
      { type: 'turn_started', runId: 'r1' },
      { type: 'iteration_started', iteration: 1 },
      { type: 'iteration_completed', iteration: 1 },
      { type: 'subcall_result', data: {} },
      { type: 'context_usage', data: {} },
      { type: 'memory_updated', data: {} },
    ]) await step(s)
    expect((document.body.textContent?.length ?? 0)).toBe(before)
  })
  it('error step thiếu message -> mặc định "không xác định"', async () => {
    const { step } = await bootLive()
    await step({ type: 'error' })
    expect(screen.getByText('Lỗi RLM: không xác định')).toBeTruthy()
  })
  it('final content rỗng -> bubble rỗng (không crash); double final -> 2 bubble', async () => {
    const { step } = await bootLive()
    await step({ type: 'final', content: '' })
    await step({ type: 'final', content: 'A' })
    await step({ type: 'final', content: 'B' })
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
  })
})

describe('U4 WS protocol biên', () => {
  it('WS data không phải JSON -> bỏ qua êm, UI không sập', async () => {
    const { socket } = await bootLive()
    await act(async () => {
      socket.emitRaw('this-is-not-json{{{')
      await new Promise((r) => setTimeout(r, 10))
    })
    // App vẫn sống: gửi tiếp vẫn được
    expect(screen.getByPlaceholderText('Nhắn gì đó cho agent...')).toBeTruthy()
  })
  it('WS message type lạ -> bỏ qua, timeline giữ nguyên', async () => {
    const { socket, step } = await bootLive()
    await step({ type: 'final', content: 'giữ lại' })
    await act(async () => {
      socket.emitMessage({ type: 'weird_future_type', sessionId: 's1' })
      socket.emitMessage({ hello: 'no-type-field' })
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(screen.getByText('giữ lại')).toBeTruthy()
  })
  it("WS 'error' khi có tool running -> chốt tool sang error + bubble 'Lỗi:'", async () => {
    const { socket, step } = await bootLive()
    await step({ type: 'tool_call', name: 'slow_tool', args: {} })
    await act(async () => {
      socket.emitMessage({ type: 'error', sessionId: 's1', message: 'LLM 500' })
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(screen.getByText('slow_tool').closest('[data-state]')?.getAttribute('data-state')).toBe('error')
    expect(screen.getByText('Lỗi: LLM 500')).toBeTruthy()
  })
  it("WS 'error' khi không có tool running -> chỉ bubble lỗi", async () => {
    const { socket } = await bootLive()
    await act(async () => {
      socket.emitMessage({ type: 'error', sessionId: 's1', message: 'turn nổ' })
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(screen.getByText('Lỗi: turn nổ')).toBeTruthy()
  })
  it('WS close 401 -> đăng xuất về LoginForm', async () => {
    const { socket } = await bootLive()
    await act(async () => {
      socket.close(401)
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeTruthy()
  })
  it('WS close thường -> composer vẫn dùng được (không deadlock)', async () => {
    const { socket } = await bootLive()
    await act(async () => {
      socket.close(1000)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect((screen.getByPlaceholderText('Nhắn gì đó cho agent...') as HTMLTextAreaElement).disabled).toBe(false)
  })
})

describe('U5 resume qua REST biên', () => {
  async function bootResume(events: unknown[]) {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    loginEnv()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/sessions')) return jsonResponse({ sessions: [{ id: 'old-1', createdAt: 5, driver: 'default' }] })
      if (url.endsWith('/sessions/old-1/events')) return jsonResponse({ events })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      return new Response(null, { status: 404 })
    }))
    await act(async () => {
      render(<App />)
      await new Promise((r) => setTimeout(r, 40))
    })
  }
  it('events rỗng -> timeline trắng, không crash', async () => {
    await bootResume([])
    expect(screen.getByPlaceholderText('Nhắn gì đó cho agent...')).toBeTruthy()
  })
  it('user + assistant + final_answer dựng đủ 3 bubble', async () => {
    await bootResume([
      { type: 'user_message', content: 'hỏi gì đó' },
      { type: 'model_message', content: 'đang nghĩ' },
      { type: 'final_answer', content: 'trả lời xong' },
    ])
    expect(screen.getByText('hỏi gì đó')).toBeTruthy()
    expect(screen.getByText('trả lời xong')).toBeTruthy()
  })
  it('model_message+toolCall rồi tool_result lỗi -> card ok (khớp live, không đỏ)', async () => {
    await bootResume([
      { type: 'model_message', content: '', toolCall: { name: 'web_search', args: { query: 'x' } } },
      { type: 'tool_result', name: 'web_search', result: { error: 'timeout', code: 'TOOL_TIMEOUT' } },
    ])
    expect(screen.getByText('web_search').closest('[data-state]')?.getAttribute('data-state')).toBe('ok')
  })
  it('tool_result không có tool chờ (pendingToolId null) -> bỏ qua', async () => {
    await bootResume([{ type: 'tool_result', name: 'lẻ', result: 1 }])
    expect(screen.queryByText('lẻ')).toBeNull()
  })
  it('tool_call RLM + error event resume đúng', async () => {
    await bootResume([
      { type: 'tool_call', name: 't2', args: {} },
      { type: 'tool_result', name: 't2', result: { ok: 1 } },
      { type: 'error', message: 'ghi chú lỗi cũ' },
    ])
    expect(screen.getByText('t2').closest('[data-state]')?.getAttribute('data-state')).toBe('ok')
    expect(screen.getByText('Lỗi RLM: ghi chú lỗi cũ')).toBeTruthy()
  })
  it('events fetch 500 -> toast lỗi, không crash app', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    loginEnv()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/sessions')) return jsonResponse({ sessions: [{ id: 'old-9', createdAt: 5, driver: 'default' }] })
      if (url.endsWith('/sessions/old-9/events')) return new Response(null, { status: 500 })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      return new Response(null, { status: 404 })
    }))
    await act(async () => {
      render(<App />)
      await new Promise((r) => setTimeout(r, 40))
    })
    expect(screen.getByPlaceholderText('Nhắn gì đó cho agent...')).toBeTruthy()
  })
})
