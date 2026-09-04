// @vitest-environment jsdom
// Bug user báo: item "📚 Skill resource" hiện rác nội bộ:
//   Đọc business-case-builder/references/kpi-framework.md.
//   [tool_call:web_search({"query":"...","limit":10})]
// Backend giờ sanitize lúc phát event, nhưng event BẨN ĐÃ LƯU trong DB cũ khi
// resume vẫn phải sạch ở lớp render cuối cùng. File này verify mirror
// apps/web/src/sanitize.ts + render đầu-cuối qua App thật.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { App } from '../src/App.tsx'
import { sanitizeEventField, stripLeakedToolCallLabels } from '../src/sanitize.ts'

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
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  FakeWebSocket.instances = []
  Element.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('mirror sanitize.ts khớp backend (cùng vectors)', () => {
  it('case user gặp exact', () => {
    const dirty = 'references/kpi-framework.md.\n[tool_call:web_search({"query":"đối thủ cạnh tranh FPT Telecom Viettel VNPT thị phần 2025","limit":10})]'
    expect(stripLeakedToolCallLabels(dirty)).toBe('references/kpi-framework.md.\n')
    expect(sanitizeEventField(dirty)).toBe('references/kpi-framework.md.')
  })
  it('nhúng giữa câu / nhiều label / paren trong string / cụt / sai cú pháp', () => {
    expect(stripLeakedToolCallLabels('a [tool_call:t({"x":1})] b')).toBe('a  b')
    expect(stripLeakedToolCallLabels('[tool_call:a({})]x[tool_call:b({})]')).toBe('x')
    expect(stripLeakedToolCallLabels('[tool_call:t({"q":"a)b]c"})]!')).toBe('!')
    expect(stripLeakedToolCallLabels('dở [tool_call:t({"q":"x')).toBe('dở [tool_call:t({"q":"x')
    expect(stripLeakedToolCallLabels('[tool_call:9bad({})]')).toBe('[tool_call:9bad({})]')
    expect(stripLeakedToolCallLabels('')).toBe('')
  })
})

describe('render: event bẩn cũ (đã lưu DB) hiện sạch', () => {
  async function bootResume(events: unknown[]) {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    localStorage.setItem('agent-core-ui-auth', JSON.stringify({ token: 't', user: { id: 'u1', username: 'a', role: 'admin' } }))
    localStorage.setItem('agent-core-ui-settings', JSON.stringify({ restUrl: 'http://x', wsUrl: 'ws://x' }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/sessions')) return jsonResponse({ sessions: [{ id: 'old-1', createdAt: 1, driver: 'rlm' }] })
      if (url.endsWith('/sessions/old-1/events')) return jsonResponse({ events })
      if (url.endsWith('/skills')) return jsonResponse({ skills: [] })
      return new Response(null, { status: 404 })
    }))
    await act(async () => {
      render(<App />)
      await new Promise((r) => setTimeout(r, 40))
    })
  }

  it('đúng ca user gặp: skill_resource path bẩn -> mô tả sạch, không còn [tool_call:', async () => {
    await bootResume([
      { type: 'skill_resource', skill: 'business-case-builder', path: 'references/kpi-framework.md.\n[tool_call:web_search({"query":"đối thủ cạnh tranh FPT Telecom Viettel VNPT thị phần 2025","limit":10})]' },
    ])
    expect(screen.getByText('📚 Skill resource')).toBeTruthy()
    expect(document.body.textContent).not.toContain('[tool_call:')
    expect(document.body.textContent).toContain('references/kpi-framework.md.')
  })

  it('skill_loaded skill bẩn + analysis bẩn + workspace_write bẩn -> đều sạch', async () => {
    await bootResume([
      { type: 'skill_loaded', skill: 'wf\n[tool_call:x({})]' },
      { type: 'analysis', content: 'nghĩ [tool_call:y({"a":1})] tiếp' },
      { type: 'workspace_write', path: 'o.csv\n[tool_call:z({})]' },
    ])
    expect(document.body.textContent).not.toContain('[tool_call:')
    expect(screen.getByText('📚 Skill')).toBeTruthy()
    expect(screen.getByText('🧠 Think')).toBeTruthy()
  })

  it('live step skill_resource bẩn -> card sạch ngay, không chờ', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    localStorage.setItem('agent-core-ui-auth', JSON.stringify({ token: 't', user: { id: 'u1', username: 'a', role: 'admin' } }))
    localStorage.setItem('agent-core-ui-settings', JSON.stringify({ restUrl: 'http://x', wsUrl: 'ws://x' }))
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url))
      const method = init?.method ?? 'GET'
      if (method === 'GET' && u.pathname === '/skills') return jsonResponse({ skills: [] })
      if (method === 'GET' && u.pathname === '/sessions') return jsonResponse({ sessions: [] })
      if (method === 'POST' && u.pathname === '/sessions') { n += 1; return jsonResponse({ id: `s${n}`, driver: 'rlm' }, 201) }
      if (method === 'POST' && /\/messages$/.test(u.pathname)) return jsonResponse({ content: '', steps: 0 })
      return new Response(null, { status: 404 })
    }))
    await act(async () => {
      render(<App />)
      await new Promise((r) => setTimeout(r, 30))
    })
    const { fireEvent } = await import('@testing-library/react')
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Nhắn gì đó cho agent...'), { target: { value: 'go' } })
      fireEvent.click(screen.getByText('Gửi'))
      await new Promise((r) => setTimeout(r, 30))
    })
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    await act(async () => {
      socket.emitMessage({ type: 'step', sessionId: 's1', step: { type: 'skill_resource', skill: 'business-case-builder', path: 'references/kpi-framework.md.\n[tool_call:web_search({"query":"q"})]' } })
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(document.body.textContent).not.toContain('[tool_call:')
    expect(document.body.textContent).toContain('references/kpi-framework.md.')
  })
})
