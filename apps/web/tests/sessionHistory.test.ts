// @vitest-environment jsdom
//
// Verify THẬT localStorage CRUD cho lịch sử session (sidebar) — không chỉ
// tin logic đúng vì code "trông hợp lý".
import { beforeEach, describe, expect, it } from 'vitest'
import { addSessionToHistory, loadSessionHistory, removeSessionFromHistory, updateSessionTitle } from '../src/sessionHistory.ts'

beforeEach(() => {
  localStorage.clear()
})

describe('sessionHistory', () => {
  it('loadSessionHistory() trên localStorage rỗng -> mảng rỗng, không throw', () => {
    expect(loadSessionHistory()).toEqual([])
  })

  it('addSessionToHistory() thêm session MỚI lên ĐẦU danh sách', () => {
    addSessionToHistory('s1')
    const list = addSessionToHistory('s2')
    expect(list.map((s) => s.id)).toEqual(['s2', 's1'])
    expect(list[0].title).toBe('Cuộc trò chuyện mới')
  })

  it('addSessionToHistory() gọi lại với id ĐÃ có -> không thêm trùng', () => {
    addSessionToHistory('s1')
    const list = addSessionToHistory('s1')
    expect(list.length).toBe(1)
  })

  it('updateSessionTitle() cập nhật đúng session, không đụng session khác', () => {
    addSessionToHistory('s1')
    addSessionToHistory('s2')
    const list = updateSessionTitle('s1', 'giá vàng SJC hôm nay bao nhiêu')
    const s1 = list.find((s) => s.id === 's1')!
    const s2 = list.find((s) => s.id === 's2')!
    expect(s1.title).toBe('giá vàng SJC hôm nay bao nhiêu')
    expect(s2.title).toBe('Cuộc trò chuyện mới')
  })

  it('updateSessionTitle() cắt bớt title quá dài, thêm dấu …', () => {
    const long = 'a'.repeat(100)
    addSessionToHistory('s1')
    const list = updateSessionTitle('s1', long)
    const s1 = list.find((s) => s.id === 's1')!
    expect(s1.title.length).toBeLessThan(long.length)
    expect(s1.title.endsWith('…')).toBe(true)
  })

  it('removeSessionFromHistory() xoá đúng session', () => {
    addSessionToHistory('s1')
    addSessionToHistory('s2')
    const list = removeSessionFromHistory('s1')
    expect(list.map((s) => s.id)).toEqual(['s2'])
  })

  it('persist qua "reload" (đọc lại localStorage bằng lần gọi loadSessionHistory() mới)', () => {
    addSessionToHistory('s1')
    updateSessionTitle('s1', 'câu hỏi đầu tiên')
    // Không giữ tham chiếu list cũ -- gọi load lại y hệt sau khi "mở lại trang".
    const reloaded = loadSessionHistory()
    expect(reloaded).toEqual([{ id: 's1', createdAt: expect.any(Number), title: 'câu hỏi đầu tiên' }])
  })

  it('localStorage chứa JSON hỏng -> load về mảng rỗng, không throw (đúng pattern settings.ts đã dùng)', () => {
    localStorage.setItem('agent-core-ui-session-history', '{not valid json')
    expect(loadSessionHistory()).toEqual([])
  })
})
