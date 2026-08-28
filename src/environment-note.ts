// Ghi chú môi trường (ngày hiện tại) chèn cuối system prompt mỗi turn cho CẢ
// hai loop driver. Lý do tồn tại: model không tự biết hôm nay là ngày nào —
// knowledge cutoff của nó luôn ở quá khứ, dẫn tới bug thật đo được qua probe
// matrix round-0 (data/probes/round-0-baseline): query search dùng năm sai
// ("CEO of OpenAI currently 2024 2025"), và trả lời current-state facts từ
// training data một cách tự tin (Node LTS "22.x tháng 11/2024"). Inject ngày
// là mitigation chuẩn trong production agents (xem thảo luận temporal
// grounding: model phải được CHO biết thời điểm hiện tại, không thể tự suy).
import { createHash } from 'node:crypto'

export interface RenderedWithEnv {
  content: string
  /** Hash lại SAU khi ghép ghi chú môi trường — giữ invariant "version mô tả đúng nội dung". */
  version: string
}

// Follow-up (2026-08, live-test tìm thấy bug thật qua 16 turn thật, xem
// docs/agent-core-web-search-year-testing.md): bản gốc chỉ cho ISO date +
// 1 câu chung "dùng THIS year" — model vẫn tự SUY ra năm từ chuỗi ngày,
// và với 2 cách hỏi cụ thể ("Tìm báo cáo mới nhất", "so sánh năm nay với
// năm ngoái") suy sai lệch đúng 1 năm CẢ 2/2 LẦN THỬ (không phải nhiễu
// ngẫu nhiên — lệch có hệ thống, thiên về năm hay gặp nhiều trong dữ liệu
// huấn luyện). Sửa bằng 2 việc: (1) tính sẵn currentYear/lastYear thành số
// nguyên, model KHÔNG cần tự parse chuỗi ISO nữa; (2) liệt kê tường minh
// đúng các cụm tiếng Việt đã fail thật ("mới nhất", "năm nay", "năm
// ngoái", "gần đây") thay vì chỉ có "hôm nay" — 3 cụm còn thiếu chính là
// nguyên nhân model không nối được chúng với ghi chú ngày ở trên.
export function environmentNote(now: Date = new Date()): string {
  const iso = now.toISOString()
  const currentYear = now.getUTCFullYear()
  const lastYear = currentYear - 1
  return [
    '',
    '## Environment',
    `- Current date: ${iso.slice(0, 10)} (${iso.slice(11, 16)} UTC). This IS "today" — current year is ${currentYear}, last year is ${lastYear}.`,
    '- Your training data ends BEFORE this date, so anything time-sensitive (versions, prices, officeholders, rankings, recent events) may have changed.',
    `- Any phrase meaning "now"/"current"/"latest"/"recent" — including Vietnamese "hôm nay", "năm nay" (this year), "mới nhất" (latest), "gần đây" (recently), "năm ngoái" (last year) — means ${currentYear} (or ${lastYear} for "last year"). NEVER reason from a year recalled from training data.`,
    `- When a request has no year specified and implies "latest"/"current"/"recent" data, your search query MUST explicitly include ${currentYear} — do not rely on your own sense of what year is "recent".`,
  ].join('\n')
}

/** Ghép ghi chú môi trường vào prompt đã render, hash lại version theo nội dung mới.
 *
 * Vị trí chèn PHỤ THUỘC DRIVER (bisect thật, xem scripts/probe/bisect-e1*.ts):
 * - 'end' (default driver): append cuối prompt — verify ổn qua probe matrix
 *   round-1 (t-group search đúng năm 2026, không lỗi format).
 * - 'identity' (rlm driver): chèn NGAY SAU đoạn identity. Append cuối prompt
 *   làm model 35B phát hành hành vi sai format "analysis chứa JSON
 *   {"repl": ...}" thay vì fenced ```repl block (e1 fail deterministic 3/3 ở
 *   round-1); cấu trúc list ở CUỐI system prompt prime model về JSON. Chèn
 *   cạnh identity loại bỏ được điều đó (json 1/12 vs 3/12, fenced 7/12 vs
 *   1/12 trên 2 lần bisect).
 */
export function injectEnvironmentNote(
  rendered: { content: string; version: string },
  position: 'end' | 'identity' = 'end',
  now: Date = new Date(),
): RenderedWithEnv {
  const note = environmentNote(now)
  let content: string
  if (position === 'identity') {
    const idx = rendered.content.indexOf('\n\n')
    content = idx === -1
      ? rendered.content + note
      : rendered.content.slice(0, idx) + note + rendered.content.slice(idx)
  } else {
    content = `${rendered.content}\n${note}`
  }
  return {
    content,
    version: createHash('sha256').update(content).digest('hex').slice(0, 12),
  }
}
