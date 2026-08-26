// packages/ui-sidebar/src/sessionHistory.ts — module auth (nhiều người
// dùng thật): trước đây PHẢI theo dõi lịch sử ở PHÍA CLIENT (localStorage)
// vì API key dùng chung không có khái niệm "chủ sở hữu" 1 session — thêm 1
// endpoint GET /sessions liệt kê tất cả session trên server sẽ rò rỉ dữ
// liệu chéo giữa những người cùng cầm 1 key. Giờ session có ownerId thật
// (gắn từ identity đã đăng nhập), server tự lọc đúng session CỦA CHÍNH
// caller — GET /sessions giờ AN TOÀN để dùng làm nguồn sự thật. localStorage
// CHỈ còn cache title hiển thị (server không lưu title, không phải việc của
// nó) — đổi tên storage key vì vai trò đã đổi hẳn, không phải cùng 1 khái
// niệm đổi chỗ.
export interface SessionSummary {
  id: string
  createdAt: number
  title: string
  /** docs/agent-core-rlm-web-ui-plugin-plan.md mục 4 — GET /sessions đã trả
   * field này từ lâu (bundles/adapters/api-rest/index.ts), nhưng bị bỏ qua
   * lúc map response ở đây (gap thật, không phải cố ý) — Sidebar cần biết
   * driver của TỪNG session cũ để hiện đúng badge. */
  driver: string
  projectId?: string
}

const TITLE_CACHE_KEY = 'agent-core-ui-session-titles'
const TITLE_MAX_LENGTH = 60

function loadTitleCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TITLE_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function saveTitleCache(cache: Record<string, string>) {
  localStorage.setItem(TITLE_CACHE_KEY, JSON.stringify(cache))
}

/**
 * Cập nhật title cache cho 1 session (gọi đúng 1 lần lúc gửi tin nhắn đầu
 * tiên — cùng thời điểm updateSessionTitle() cũ đã gọi). Cắt bớt >60 ký tự.
 * Trả về title đã cắt — App.tsx dùng giá trị này để đồng bộ luôn state
 * `sessions` cục bộ (React state), không cần refetch GET /sessions chỉ để
 * lấy lại đúng chuỗi vừa tự tính.
 */
export function cacheSessionTitle(id: string, rawTitle: string): string {
  const cache = loadTitleCache()
  const title = rawTitle.length > TITLE_MAX_LENGTH ? `${rawTitle.slice(0, TITLE_MAX_LENGTH)}…` : rawTitle
  cache[id] = title
  saveTitleCache(cache)
  return title
}

export function clearCachedTitle(id: string): void {
  const cache = loadTitleCache()
  delete cache[id]
  saveTitleCache(cache)
}

/**
 * Gọi GET /sessions thật, merge với title cache phía client (server không
 * lưu title). Session chưa từng có tin nhắn nào cache title (vd. mở từ
 * trình duyệt khác, hoặc cache đã bị xoá) -> fallback theo giờ tạo, KHÔNG
 * phải "Cuộc trò chuyện mới" chung chung (dễ gây nhầm với session vừa tạo
 * thật). Sort mới nhất trước.
 */
export async function fetchSessionHistory(restUrl: string, token: string): Promise<SessionSummary[]> {
  const res = await fetch(`${restUrl}/sessions`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`không tải được danh sách cuộc trò chuyện (lỗi ${res.status})`)
  const { sessions } = (await res.json()) as { sessions: { id: string; createdAt: number; driver: string; projectId?: string }[] }
  const titles = loadTitleCache()
  return sessions
    .map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      driver: s.driver,
      projectId: s.projectId,
      title: titles[s.id] ?? `Cuộc trò chuyện lúc ${new Date(s.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}
