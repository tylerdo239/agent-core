// Bug thật phát hiện qua log production (2026-08, session
// 9e47c762-3b2b-409f-8ced-fd3c32c82034, seq 18 — không phải giả thuyết):
//
//   model_message content = '[tool_call:read_skill_resource({"name":"business-case-builder","path":"references/scientific-analysis-guide.md"})]'
//   toolCall: (không có — response.toolCall undefined)
//
// Nguyên nhân gốc: `Session.recordAssistant()` (seams/loop.ts) và
// `session-registry`'s `replay()` chèn nhãn nội bộ dạng
// `[tool_call:<name>(<json args>)]` vào NGAY message role 'assistant' trong
// `session.history` — history này được gửi thẳng lại cho model ở mọi turn
// sau. Sau khi model đã thấy chính nhãn này 2 lần trong lượt trước (turn
// gọi `skill`, turn gọi `read_skill_resource` lần 1), tới turn thứ 3 model
// TỰ BẮT CHƯỚC lại đúng cú pháp đó như plain text content, thay vì gọi tool
// thật qua API tool-calling — cùng lớp lỗi với bug ChatML-leak đã fix trước
// đó (model học lại pattern nó thấy trong chính context của nó và tái tạo
// sai chỗ), chỉ khác định dạng leak và khác trường bị ảnh hưởng (`content`
// thay vì `tool_calls[].name`).
//
// Fix: khôi phục lại Ý ĐỊNH thật của model — parse đúng tên tool + JSON args
// từ nhãn bị leak, coi như model ĐÃ gọi tool đó, để loop-default thực thi
// tool thật thay vì để lượt đó trôi qua như 1 câu trả lời cụt lủn kèm rác
// hiển thị xấu cho user.
const LEAKED_LABEL_PATTERN = /^\[tool_call:([a-zA-Z_][\w-]*)\((.*)\)\]\s*$/s

export interface RepairableResponse {
  content: string
  toolCall?: { name: string; args: Record<string, unknown> }
}

/**
 * Không đè lên response đã có toolCall thật (không bao giờ tự đoán khi model
 * đã dùng đúng API). Chỉ sửa khi content KHỚP CHÍNH XÁC nhãn leak, JSON args
 * parse được thành object hợp lệ, và tên tool đó THẬT SỰ tồn tại trong bộ
 * tool hiện có (`toolExists`) — tránh đoán bừa khi chỉ là văn bản trùng hợp.
 */
export function repairLeakedToolCallLabel<T extends RepairableResponse>(
  response: T,
  toolExists: (name: string) => boolean,
): T {
  if (response.toolCall) return response
  const match = LEAKED_LABEL_PATTERN.exec(response.content.trim())
  if (!match) return response
  const [, name, argsRaw] = match
  if (!toolExists(name)) return response
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return response
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return response
  return { ...response, content: '', toolCall: { name, args: args as Record<string, unknown> } }
}
