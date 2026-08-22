// packages/ui-sidebar/src/groupSessionsByDate.ts — nhóm lịch sử hội thoại
// theo ngày (Hôm nay / Hôm qua / ngày cụ thể), lấy cảm hứng từ cách dsh gom
// nhóm session-list theo ngày (packages/client/ui-workspace, đọc pattern
// thật — KHÔNG copy code, viết lại thuần trên `SessionSummary.createdAt` đã
// có sẵn của agent-core).
//
// `now` nhận qua tham số (mặc định `new Date()`) thay vì gọi `Date.now()`
// thẳng bên trong — để test được xác định (deterministic), không phụ thuộc
// đồng hồ thật lúc chạy test.
import type { SessionSummary } from './sessionHistory.ts'

export interface SessionDateGroup {
  label: string
  sessions: SessionSummary[]
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

// Tự ráp chuỗi "dd/MM"/"dd/MM/yyyy" thay vì toLocaleDateString('vi-VN', ...)
// — gap thật phát hiện lúc viết test: cùng locale 'vi-VN' nhưng BỎ year thì
// ICU trả về dấu GẠCH NGANG ("15-08"), CÓ year thì trả về dấu GẠCH CHÉO
// ("31/12/2025") — 2 định dạng khác nhau tuỳ có year hay không, và phụ
// thuộc dữ liệu ICU của runtime (có thể khác giữa máy dev và container
// Docker). Tự ráp chuỗi đảm bảo LUÔN nhất quán 1 định dạng, không phụ
// thuộc môi trường.
function formatOlderDate(d: Date, now: Date): string {
  const dd = pad2(d.getDate())
  const mm = pad2(d.getMonth() + 1)
  return d.getFullYear() === now.getFullYear() ? `${dd}/${mm}` : `${dd}/${mm}/${d.getFullYear()}`
}

/**
 * `sessions` PHẢI đã sắp xếp mới nhất trước (đúng thứ tự
 * `addSessionToHistory()` đảm bảo) — hàm này CHỈ gom nhóm theo thứ tự sẵn
 * có, không tự sắp xếp lại; nhóm xuất hiện theo đúng thứ tự lần đầu gặp
 * (Hôm nay -> Hôm qua -> các ngày cũ hơn, mới tới cũ).
 */
export function groupSessionsByDate(sessions: SessionSummary[], now: Date = new Date()): SessionDateGroup[] {
  const today = startOfDay(now)
  const yesterday = today - 86_400_000

  const order: string[] = []
  const map = new Map<string, SessionSummary[]>()

  for (const s of sessions) {
    const d = new Date(s.createdAt)
    const day = startOfDay(d)
    const label = day === today ? 'Hôm nay' : day === yesterday ? 'Hôm qua' : formatOlderDate(d, now)
    if (!map.has(label)) {
      map.set(label, [])
      order.push(label)
    }
    map.get(label)!.push(s)
  }

  return order.map((label) => ({ label, sessions: map.get(label)! }))
}
