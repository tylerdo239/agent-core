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

export function environmentNote(now: Date = new Date()): string {
  const iso = now.toISOString()
  return [
    '',
    '## Environment',
    `- Current date: ${iso.slice(0, 10)} (${iso.slice(11, 16)} UTC). This IS "today".`,
    '- Your training data ends BEFORE this date, so anything time-sensitive (versions, prices, officeholders, rankings, recent events) may have changed.',
    '- When constructing search queries or reasoning about "current"/"latest"/"hôm nay", use THIS year, never a year recalled from training data.',
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
