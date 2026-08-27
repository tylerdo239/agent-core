// Bug thật production (2026-08, session 9e47c762-3b2b-409f-8ced-fd3c32c82034,
// seq 18 -- xem src/leaked-tool-call-label.ts cho full root-cause): model bắt
// chước lại nhãn nội bộ `[tool_call:name(args)]` (chính history của nó chứa
// nhãn này, xem Session.recordAssistant) như plain text content thay vì gọi
// tool thật qua API. repairLeakedToolCallLabel() khôi phục lại ý định thật.
import { describe, expect, it } from 'vitest'
import { repairLeakedToolCallLabel } from '../src/leaked-tool-call-label.ts'

const toolExists = (names: string[]) => (name: string) => names.includes(name)

describe('repairLeakedToolCallLabel()', () => {
  it('case thật từ production: khôi phục đúng tên tool + args, content về rỗng', () => {
    const response = {
      content: '[tool_call:read_skill_resource({"name":"business-case-builder","path":"references/scientific-analysis-guide.md"})]',
    }
    const repaired = repairLeakedToolCallLabel(response, toolExists(['read_skill_resource']))
    expect(repaired).toEqual({
      content: '',
      toolCall: { name: 'read_skill_resource', args: { name: 'business-case-builder', path: 'references/scientific-analysis-guide.md' } },
    })
  })

  it('không đè lên response đã có toolCall thật (không đoán khi model đã dùng đúng API)', () => {
    const response = { content: 'irrelevant', toolCall: { name: 'web_search', args: { query: 'x' } } }
    expect(repairLeakedToolCallLabel(response, toolExists(['web_search', 'read_skill_resource']))).toBe(response)
  })

  it('tên tool trong nhãn KHÔNG tồn tại trong bộ tool hiện có -> không đoán bừa, giữ nguyên content gốc', () => {
    const response = { content: '[tool_call:not_a_real_tool({"x":1})]' }
    expect(repairLeakedToolCallLabel(response, toolExists(['web_search']))).toBe(response)
  })

  it('JSON args hỏng -> không đoán bừa, giữ nguyên', () => {
    const response = { content: '[tool_call:web_search({broken json})]' }
    expect(repairLeakedToolCallLabel(response, toolExists(['web_search']))).toBe(response)
  })

  it('args không phải object (mảng/số/chuỗi) -> không đoán bừa, giữ nguyên', () => {
    const response = { content: '[tool_call:web_search([1,2,3])]' }
    expect(repairLeakedToolCallLabel(response, toolExists(['web_search']))).toBe(response)
  })

  it('content bình thường không khớp pattern -> giữ nguyên, không throw', () => {
    const response = { content: 'Đây là câu trả lời bình thường, không liên quan tool call nào.' }
    expect(repairLeakedToolCallLabel(response, toolExists(['web_search']))).toBe(response)
  })

  it('content rỗng -> giữ nguyên', () => {
    const response = { content: '' }
    expect(repairLeakedToolCallLabel(response, toolExists(['web_search']))).toBe(response)
  })
})
