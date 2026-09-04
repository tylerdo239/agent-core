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
const LEAKED_LABEL_OPEN = /\[tool_call:([a-zA-Z_][\w-]*)\(/g

export interface RepairableResponse {
  content: string
  toolCall?: { name: string; args: Record<string, unknown> }
}

/**
 * Không đè lên response đã có toolCall thật (không bao giờ tự đoán khi model
 * đã dùng đúng API). Chỉ sửa khi content KHỚP CHÍNH XÁC nhãn leak, JSON args
 * parse được thành object hợp lệ, và tên tool đó THẬT SỰ tồn tại trong bộ
 * tool hiện có (`toolExists`) — tránh đoán bừa khi chỉ là văn bản trùng hợp.
 *
 * Kiểu trả về `T & RepairableResponse`: hàm có thể THÊM `toolCall` vào response
 * vốn không có (đúng vai trò "khôi phục ý định"), nên caller luôn đọc được
 * `.toolCall` mà không cần cast — trước đây khai `T` thuần khiến TypeScript
 * hiểu nhầm là "không bao giờ thêm field mới".
 */
export function repairLeakedToolCallLabel<T extends RepairableResponse>(
  response: T,
  toolExists: (name: string) => boolean,
): T & RepairableResponse {
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

// Bug production tiếp theo (user báo UI hiện rác — xem ghi chú triển khai ở
// cuối file): model không chỉ echo nhãn nội bộ `[tool_call:name(args)]` như
// ĐÚNG 1 content (case repair ở trên cứu được), mà còn NHÚNG nó giữa text
// dài, hoặc tệ hơn là nhét vào ARG của tool/event khác (vd. path của
// `skill_resource` = `references/kpi-framework.md.\n[tool_call:web_search({...})]`),
// rồi chuỗi bẩn đó chảy verbatim qua event → storage → UI. repair() exact-match
// bỏ lọt 100% các case này — user thấy JSON kỹ thuật thô.
//
// Fix: STRIP mọi nhãn well-formed khỏi chuỗi hiển thị/field sự kiện. Nhãn nội
// bộ không bao giờ là nội dung user-facing hợp lệ, nên xoá là an toàn (không
// đoán ý định như repair). Quét cân bằng ngoặc có tôn trọng string quote để
// JSON args chứa `)]` (vd. query "a)b]c") không làm strip dở dang.
export function stripLeakedToolCallLabels(text: string): string {
  if (!text || !text.includes('[tool_call:')) return text
  let out = ''
  let cursor = 0
  LEAKED_LABEL_OPEN.lastIndex = 0
  while (true) {
    LEAKED_LABEL_OPEN.lastIndex = cursor
    const match = LEAKED_LABEL_OPEN.exec(text)
    if (!match || match.index < cursor) break
    const scan = match.index + match[0].length
    const end = findLabelEnd(text, scan)
    if (end === -1) {
      // Mở nhãn nhưng không đóng hợp lệ (model gõ dở, cụt) — giữ nguyên phần
      // còn lại, không mangle text thật của user.
      break
    }
    out += text.slice(cursor, match.index)
    cursor = end
  }
  return out + text.slice(cursor)
}

/** Từ sau `name(`, tìm `)]` đóng tương ứng; -1 nếu cụt/không hợp lệ. */
function findLabelEnd(text: string, from: number): number {
  let depth = 1
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      // Bỏ qua string quote (JSON args) — `)]` trong query là data, không
      // phải đóng nhãn. Tôn trọng backslash escape.
      const quote = ch
      i++
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === quote) break
        i++
      }
      i++ // qua quote đóng (hoặc hết chuỗi -> vòng ngoài trả -1)
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) {
        return text[i + 1] === ']' ? i + 2 : -1
      }
    }
    i++
  }
  return -1
}

/**
 * Field sự kiện/model-controlled (skill name, resource path, tool name...):
 * strip nhãn + ép 1 dòng + trim. Path/name hợp lệ không bao giờ chứa newline;
 * cắt dòng đầu để arg bẩn kiểu `path + "\\n" + label` không lọt rác xuống UI
 * ngay cả khi label vì lý do nào đó không well-formed (không strip được).
 *
 * Gọi hàm này NGAY KHI nhận arg từ model, TRƯỚC khi tra cứu/thực thi — không
 * phải lúc dựng event. Chuỗi hiển thị ra UI và chuỗi thật sự dùng để invoke/
 * readResource phải là một, nếu không UI ghi `web_search` trong khi harness
 * gọi `web_search\n[tool_call:...]` rồi fail TOOL_NOT_FOUND.
 */
export function sanitizeEventField(value: unknown): string {
  const stripped = stripLeakedToolCallLabels(String(value ?? ''))
  const firstLine = stripped.split('\n', 1)[0] ?? ''
  return firstLine.replace(/\r$/, '').trim()
}
