// Bug user báo: UI hiện rác nội bộ trong item "📚 Skill resource":
//   Đọc business-case-builder/references/kpi-framework.md.
//   [tool_call:web_search({"query":"đối thủ ...","limit":10})]
// Nhãn `[tool_call:...]` nhúng giữa text / trong arg event lọt verbatim ra UI
// vì repairLeakedToolCallLabel chỉ cứu exact-match toàn chuỗi.
import { describe, expect, it } from 'vitest'
import { sanitizeEventField, stripLeakedToolCallLabels } from '../src/leaked-tool-call-label.ts'

describe('stripLeakedToolCallLabels — tái hiện bug user báo', () => {
  it('case user gặp: path + newline + label -> chỉ còn path sạch', () => {
    const dirty = 'references/kpi-framework.md.\n[tool_call:web_search({"query":"đối thủ cạnh tranh FPT Telecom Viettel VNPT thị phần 2025","limit":10})]'
    expect(stripLeakedToolCallLabels(dirty)).toBe('references/kpi-framework.md.\n')
  })
  it('label nhúng giữa câu -> biến mất, text xung quanh giữ nguyên', () => {
    expect(stripLeakedToolCallLabels('Xem xong [tool_call:skill({"name":"a"})] rồi kết luận nhé'))
      .toBe('Xem xong  rồi kết luận nhé')
  })
  it('nhiều label liên tiếp -> strip hết', () => {
    expect(stripLeakedToolCallLabels('[tool_call:a({})] giữa [tool_call:b-c_2({"x":[1,2]})] cuối'))
      .toBe(' giữa  cuối')
  })
  it('JSON args chứa paren/bracket trong string ("a)b]c") -> strip trọn, không dở dang', () => {
    const dirty = 'q: [tool_call:web_search({"query":"a)b]c (test)"})] xong'
    expect(stripLeakedToolCallLabels(dirty)).toBe('q:  xong')
  })
  it('JSON args chứa quote escape -> strip trọn', () => {
    const dirty = '[tool_call:t({"q":"he said \\"hi\\""})]'
    expect(stripLeakedToolCallLabels(dirty)).toBe('')
  })
  it('mở nhãn nhưng cụt (không đóng) -> giữ nguyên, không mangle', () => {
    const partial = 'đang gọi [tool_call:web_search({"query":"dở'
    expect(stripLeakedToolCallLabels(partial)).toBe(partial)
  })
  it('tên tool sai cú pháp / thiếu paren -> giữ nguyên', () => {
    for (const t of ['[tool_call:9bad({})]', '[tool_call:has space({})]', '[tool_call:noparen]', '[tool_call:]', 'tool_call:a({})']) {
      expect(stripLeakedToolCallLabels(t)).toBe(t)
    }
  })
  it('text thường/không nhãn/rỗng -> giữ nguyên (kể cả chữ "tool_call" lẻ)', () => {
    expect(stripLeakedToolCallLabels('')).toBe('')
    expect(stripLeakedToolCallLabels('xin chào')).toBe('xin chào')
    expect(stripLeakedToolCallLabels('hàm tool_call dùng để gọi')).toBe('hàm tool_call dùng để gọi')
  })
  it('multiline args (pretty JSON) -> strip trọn cả khối', () => {
    const dirty = 'trước\n[tool_call:t({\n"a": 1,\n"b": [1, 2]\n})]\nsau'
    expect(stripLeakedToolCallLabels(dirty)).toBe('trước\n\nsau')
  })
})

describe('sanitizeEventField — field sự kiện model-controlled', () => {
  it('path bẩn kiểu user gặp -> 1 dòng sạch đã trim', () => {
    expect(sanitizeEventField('references/kpi-framework.md.\n[tool_call:web_search({"query":"x"})]'))
      .toBe('references/kpi-framework.md.')
  })
  it('skill/path sạch giữ nguyên (chỉ trim viền)', () => {
    expect(sanitizeEventField('  business-case-builder  ')).toBe('business-case-builder')
    expect(sanitizeEventField('references/a.md')).toBe('references/a.md')
  })
  it('null/undefined/số -> chuỗi rỗng/số-str, không throw', () => {
    expect(sanitizeEventField(null)).toBe('')
    expect(sanitizeEventField(undefined)).toBe('')
    expect(sanitizeEventField(42)).toBe('42')
  })
})
