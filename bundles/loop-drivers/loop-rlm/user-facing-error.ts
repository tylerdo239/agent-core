// Văn bản lỗi HƯỚNG TỚI USER, tách hẳn khỏi ERROR_TAXONOMY trong src/errors.ts
// (bản đó hướng tới MODEL: tiếng Anh, dạng mệnh lệnh "hãy làm X tiếp theo").
//
// Bug thật user báo: turn RLM cạn error budget, user Việt nhận nguyên chuỗi
// "Error threshold exceeded: 3 consecutive errors (limit: 3)" — jargon nội bộ
// của thư viện, không một chữ giải thích hay gợi ý. Tệ hơn: đúng lúc đó RLM đã
// có sẵn phần trả lời tốt nhất tới thời điểm lỗi (`partial_answer` đính kèm
// chính exception ấy) mà harness vứt đi.
//
// Khác default-loop ở chỗ nào: default-loop đưa lỗi tool vào history rồi MODEL
// tự diễn giải lại trong cùng turn; RLM thì exception cắt ngang trước khi model
// kịp nói gì, nên harness phải tự lo phần diễn giải.
// Đặt TRONG bundle chứ không ở src/: chỉ loop-rlm dùng. `src/` dành cho thứ
// từ 2 bundle trở lên cùng cần (leaked-tool-call-label, skill-runtime,
// environment-note...) — không phải để chứa mọi hàm thuần. Bundle nào tự dùng
// một mình thì giữ trong bundle đó, gỡ bundle là gỡ luôn, không để lại file
// mồ côi ở src/.
import type { HarnessErrorCode } from '../../../src/errors.ts'

/** Một câu tiếng Việt: chuyện gì đã xảy ra + nên làm gì tiếp. */
const USER_MESSAGE: Partial<Record<HarnessErrorCode, string>> = {
  NO_PROGRESS: 'phiên phân tích gặp lỗi liên tiếp nhiều lần nên đã dừng để khỏi chạy lòng vòng. Thử diễn đạt lại yêu cầu cụ thể hơn, hoặc chia nhỏ thành từng bước.',
  TIMEOUT: 'lượt này chạy quá lâu nên đã bị dừng. Thử thu hẹp phạm vi câu hỏi hoặc giảm lượng dữ liệu cần xử lý.',
  CODE_RUNTIME: 'đoạn code phân tích gặp lỗi khi chạy. Kiểm tra lại dữ liệu đầu vào, hoặc mô tả rõ hơn định dạng dữ liệu bạn có.',
  CODE_PARSE: 'phiên phân tích không tạo được đoạn code hợp lệ để chạy. Thử diễn đạt lại yêu cầu.',
  CONTEXT_OVERFLOW: 'nội dung phiên đã vượt quá sức chứa ngữ cảnh. Bắt đầu một phiên mới, hoặc tóm tắt lại phần cần dùng.',
  LLM_PROVIDER: 'không gọi được mô hình ngôn ngữ. Đây là sự cố hạ tầng — thử lại sau ít phút.',
  WORKER: 'tiến trình phân tích dừng bất thường. Thử lại; nếu lặp lại nhiều lần thì báo quản trị viên.',
  TOOL_NOT_FOUND: 'phiên phân tích gọi một công cụ không tồn tại. Đây là lỗi cấu hình phía hệ thống.',
  TOOL_EXEC: 'một công cụ chạy lỗi. Thử lại, hoặc hỏi theo hướng khác nếu lỗi lặp lại.',
  TOOL_ARGS: 'một công cụ được gọi với tham số không hợp lệ. Thử diễn đạt lại yêu cầu cụ thể hơn.',
  SKILL_MISSING: 'không tìm thấy skill mà phiên phân tích cần dùng.',
  SKILL_READ: 'không đọc được tài liệu của skill đang dùng.',
  CONTRACT: 'phiên phân tích trả về dữ liệu sai định dạng quy ước. Đây là lỗi phía hệ thống.',
  STATE_CORRUPT: 'trạng thái phiên bị hỏng. Hãy bắt đầu một phiên mới.',
  HUMAN_DENIED: 'thao tác bị từ chối nên lượt này dừng lại.',
  CANCELLED: 'lượt này đã bị huỷ.',
}

const FALLBACK = 'lượt này không hoàn tất được.'

export interface TurnFailureText {
  /** Nội dung trả về cho user. */
  content: string
  /** true nếu có phần kết quả dở dang được giữ lại. */
  hasPartial: boolean
}

/**
 * Dựng nội dung user đọc được cho một turn thất bại.
 *
 * `rawMessage` KHÔNG đi vào đây — nó là jargon nội bộ, đã được lưu nguyên vẹn
 * trong event `error` và `turn_issue` để debug. Người dùng không cần đọc nó.
 */
export function turnFailureText(
  code: HarnessErrorCode | undefined,
  partialAnswer?: string,
): TurnFailureText {
  const reason = (code && USER_MESSAGE[code]) || FALLBACK
  const notice = `⚠️ Lượt này chưa hoàn tất — ${reason}`
  const partial = partialAnswer?.trim()
  if (!partial) return { content: notice, hasPartial: false }
  // Phần đã làm được đứng TRƯỚC: nó là thứ có giá trị với user, lời giải thích
  // chỉ là ghi chú tại sao chưa xong.
  return { content: `${partial}\n\n---\n\n${notice}`, hasPartial: true }
}
