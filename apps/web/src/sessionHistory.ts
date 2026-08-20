// apps/web/src/sessionHistory.ts — theo dõi lịch sử session ở PHÍA CLIENT
// (localStorage), KHÔNG phải server-side. Lý do chủ động: backend
// (session-registry) không có khái niệm "chủ sở hữu" 1 session — API key
// hiện tại là 1 key dùng chung nội bộ, không tách theo user. Nếu thêm 1
// endpoint REST `GET /sessions` liệt kê TẤT CẢ session trên server, bất kỳ
// ai cầm key cũng thấy được session của người khác — rò rỉ dữ liệu chéo
// không cần thiết. Theo dõi client-side tránh hẳn vấn đề đó: mỗi trình
// duyệt chỉ thấy đúng session NÓ đã tạo.
export interface SessionSummary {
  id: string
  createdAt: number
  title: string
}

const STORAGE_KEY = 'agent-core-ui-session-history'
const MAX_HISTORY = 50
const TITLE_MAX_LENGTH = 60

export function loadSessionHistory(): SessionSummary[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveSessionHistory(list: SessionSummary[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

/** Thêm 1 session mới lên ĐẦU danh sách (mới nhất trước) — bỏ qua nếu đã có (không trùng lặp khi resume). */
export function addSessionToHistory(id: string): SessionSummary[] {
  const list = loadSessionHistory()
  if (list.some((s) => s.id === id)) return list
  const next = [{ id, createdAt: Date.now(), title: 'Cuộc trò chuyện mới' }, ...list].slice(0, MAX_HISTORY)
  saveSessionHistory(next)
  return next
}

/** Cập nhật title bằng câu hỏi ĐẦU TIÊN thật của user (gọi đúng 1 lần lúc gửi tin nhắn đầu tiên của session). */
export function updateSessionTitle(id: string, rawTitle: string): SessionSummary[] {
  const list = loadSessionHistory()
  const title = rawTitle.length > TITLE_MAX_LENGTH ? `${rawTitle.slice(0, TITLE_MAX_LENGTH)}…` : rawTitle
  const next = list.map((s) => (s.id === id ? { ...s, title } : s))
  saveSessionHistory(next)
  return next
}

export function removeSessionFromHistory(id: string): SessionSummary[] {
  const next = loadSessionHistory().filter((s) => s.id !== id)
  saveSessionHistory(next)
  return next
}
