// Phase 8.1 + 8.2 deliverable: session-registry không còn giữ session vĩnh
// viễn (TTL trượt theo hoạt động), và Session.history không còn phình vô hạn
// (sliding window). Coding rule A14 — cả 2 đều là "provider giữ state sống
// lâu hơn 1 request" phải có câu trả lời rõ cho "cái gì khiến nó không lớn
// vô hạn".
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import { Session } from '../seams/loop.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('Phase 8.1 — session-registry TTL (trượt theo hoạt động)', () => {
  it('session bị bỏ quên quá ttlMs bị sweep xoá; session được get() liên tục thì sống sót', async () => {
    const root = new Context()
    const fiber = root.plugin(sessionRegistry, { ttlMs: 80, sweepIntervalMs: 20 })
    await settle()
    await fiber.await()

    const active = root.sessions.create({ id: 'active' })
    const abandoned = root.sessions.create({ id: 'abandoned' })
    expect(active).toBeTruthy()
    expect(abandoned).toBeTruthy()

    // 'active' được get() liên tục (mô phỏng đang chat) -- KHÔNG được sweep dù
    // đã tồn tại lâu hơn ttlMs gốc tính từ lúc tạo.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 30))
      expect(root.sessions.get('active')).toBeTruthy()
    }
    // 'abandoned' không ai get() lại -> phải bị sweep trong lúc đó.
    expect(root.sessions.get('abandoned')).toBeUndefined()
    expect(root.sessions.list().map((s) => s.id)).toEqual(['active'])

    await fiber.dispose()
  })

  it('remove() xoá ngay lập tức, không cần đợi sweep', async () => {
    const root = new Context()
    const fiber = root.plugin(sessionRegistry, { ttlMs: 10_000, sweepIntervalMs: 10_000 })
    await settle()
    await fiber.await()

    root.sessions.create({ id: 'x' })
    expect(root.sessions.remove('x')).toBe(true)
    expect(root.sessions.get('x')).toBeUndefined()
    expect(root.sessions.remove('khong-ton-tai')).toBe(false)

    await fiber.dispose()
  })

  it('mount -> unmount -> sweep interval dọn sạch (không leak timer)', async () => {
    const root = new Context()
    const fiber = root.plugin(sessionRegistry, { sweepIntervalMs: 10 })
    await settle()
    await fiber.await()
    root.sessions.create({ id: 'x' })

    await fiber.dispose()
    expect(root.reflect.get('sessions', false)).toBeUndefined()
    // Không có API trực tiếp để "đếm timer sống" từ bên ngoài process test --
    // nhưng nếu interval không bị clear, callback của nó sẽ throw khi gọi
    // .sweepExpired() trên instance đã dispose sau khi test kết thúc và
    // process thoát; vitest sẽ báo lỗi "unhandled" nếu điều đó xảy ra. Đợi
    // qua vài chu kỳ sweepIntervalMs để xác nhận không có gì nổ ra.
    await new Promise((r) => setTimeout(r, 50))
  })
})

describe('Phase 8.2 — Session.history sliding window', () => {
  it('history không vượt maxHistoryMessages, giữ nguyên message system đầu tiên', () => {
    const session = new Session('s', 8, 'bạn là trợ lý', 'default', 4)
    session.buildPrompt('câu 1')
    session.recordAssistant('trả lời 1')
    session.buildPrompt('câu 2')
    session.recordAssistant('trả lời 2')
    session.buildPrompt('câu 3')
    session.recordAssistant('trả lời 3')

    expect(session.history.length).toBeLessThanOrEqual(4)
    expect(session.history[0]).toEqual({ role: 'system', content: 'bạn là trợ lý' })
    // Message gần nhất phải còn nguyên -- bị cắt là phần CŨ, không phải mới.
    expect(session.history.at(-1)).toEqual({ role: 'assistant', content: 'trả lời 3' })
    expect(session.history.some((m) => m.content === 'câu 1')).toBe(false)
  })

  it('không có system prompt -- budget dùng trọn maxHistoryMessages (không trừ 1 slot oan)', () => {
    const session = new Session('s', 8, undefined, 'default', 3)
    session.buildPrompt('câu 1')
    session.recordAssistant('trả lời 1')
    session.buildPrompt('câu 2')
    session.recordAssistant('trả lời 2')

    expect(session.history.length).toBe(3)
    expect(session.history.map((m) => m.content)).toEqual(['trả lời 1', 'câu 2', 'trả lời 2'])
  })

  it('recordToolResult cũng trim, không chỉ buildPrompt/recordAssistant', () => {
    const session = new Session('s', 8, 'sys', 'default', 3)
    session.recordToolResult('t1', { a: 1 })
    session.recordToolResult('t2', { a: 2 })
    session.recordToolResult('t3', { a: 3 })

    expect(session.history.length).toBe(3)
    expect(session.history[0]).toEqual({ role: 'system', content: 'sys' })
    expect(session.history[1].content).toContain('t2')
    expect(session.history[2].content).toContain('t3')
  })
})

describe('Phase 25 — buildPrompt() gộp mọi extraSystemNotes thành ĐÚNG 1 message system', () => {
  // Gap thật phát hiện qua verify Docker end-to-end với memory-tencentdb
  // (không phải giả thuyết): >=2 message role 'system' riêng biệt trong 1
  // request khiến proxy Qwen (vLLM/litellm) trả 400 thật "System message
  // must be at the beginning." -- xác nhận bằng curl trực tiếp vào proxy.
  // Bug có trước memory (Phase 15, skill), chỉ chưa lộ ra vì chưa từng có
  // >=2 note cùng lúc trước đây.
  it('system prompt gốc + nhiều note -> chỉ 1 message role system, đứng đầu, gộp đủ nội dung', () => {
    const session = new Session('s', 8, 'Bạn là trợ lý hữu ích.')
    const prompt = session.buildPrompt('câu hỏi', ['skill note A', 'memory note B'])

    const systemMessages = prompt.filter((m) => m.role === 'system')
    expect(systemMessages.length).toBe(1)
    expect(prompt[0].role).toBe('system')
    expect(prompt[0].content).toContain('Bạn là trợ lý hữu ích.')
    expect(prompt[0].content).toContain('skill note A')
    expect(prompt[0].content).toContain('memory note B')
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'câu hỏi' })
  })

  it('không có system prompt gốc -- vẫn chỉ 1 message system (từ các note), không lẫn message system rời', () => {
    const session = new Session('s', 8, undefined)
    const prompt = session.buildPrompt('câu hỏi', ['note A', 'note B', 'note C'])

    const systemMessages = prompt.filter((m) => m.role === 'system')
    expect(systemMessages.length).toBe(1)
    expect(prompt[0].content).toBe('note A\n\nnote B\n\nnote C')
  })

  it('không có note nào -- không tự thêm message system thừa, giữ nguyên history', () => {
    const session = new Session('s', 8, 'sys')
    const prompt = session.buildPrompt('câu hỏi', [])

    expect(prompt.filter((m) => m.role === 'system').length).toBe(1)
    expect(prompt[0]).toEqual({ role: 'system', content: 'sys' })
  })
})
