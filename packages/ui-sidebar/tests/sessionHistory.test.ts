// @vitest-environment jsdom
//
// Module auth: sessionHistory.ts đổi vai trò từ "localStorage là nguồn sự
// thật" sang "GET /sessions server là nguồn sự thật, localStorage chỉ cache
// title" — test lại THẬT theo hành vi mới (không phải relocation, hành vi
// thay đổi thật).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheSessionTitle, clearCachedTitle, fetchSessionHistory } from '../src/sessionHistory.ts'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sessionHistory', () => {
  it('cacheSessionTitle() rồi fetchSessionHistory() -> title cache đúng, KHÔNG lấy title từ server (server không trả title)', async () => {
    cacheSessionTitle('s1', 'giá vàng SJC hôm nay bao nhiêu')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [{ id: 's1', createdAt: 1000, driver: 'default', maxSteps: 8 }] }) }),
    )

    const list = await fetchSessionHistory('http://localhost:8787', 'tok')
    expect(list).toEqual([{ id: 's1', createdAt: 1000, driver: 'default', title: 'giá vàng SJC hôm nay bao nhiêu' }])
  })

  it('session chưa có title cache -> fallback theo giờ tạo, không phải chuỗi rỗng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [{ id: 's2', createdAt: Date.now() }] }) }))

    const list = await fetchSessionHistory('http://localhost:8787', 'tok')
    expect(list[0].title).toMatch(/^Cuộc trò chuyện lúc /)
  })

  it('cacheSessionTitle() cắt bớt title quá dài, thêm dấu …, trả về đúng title đã cắt', async () => {
    const long = 'a'.repeat(100)
    const returned = cacheSessionTitle('s1', long)
    expect(returned.length).toBeLessThan(long.length)
    expect(returned.endsWith('…')).toBe(true)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [{ id: 's1', createdAt: 1 }] }) }))
    const list = await fetchSessionHistory('http://localhost:8787', 'tok')
    expect(list[0].title).toBe(returned)
  })

  it('clearCachedTitle() xoá đúng title, không đụng title khác', async () => {
    cacheSessionTitle('s1', 'câu hỏi 1')
    cacheSessionTitle('s2', 'câu hỏi 2')
    clearCachedTitle('s1')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessions: [
            { id: 's1', createdAt: 1 },
            { id: 's2', createdAt: 2 },
          ],
        }),
      }),
    )

    const list = await fetchSessionHistory('http://localhost:8787', 'tok')
    expect(list.find((s) => s.id === 's2')!.title).toBe('câu hỏi 2')
    expect(list.find((s) => s.id === 's1')!.title).toMatch(/^Cuộc trò chuyện lúc /)
  })

  it('sắp xếp mới nhất trước dù server trả thứ tự khác', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessions: [
            { id: 'old', createdAt: 1 },
            { id: 'new', createdAt: 100 },
          ],
        }),
      }),
    )
    const list = await fetchSessionHistory('http://localhost:8787', 'tok')
    expect(list.map((s) => s.id)).toEqual(['new', 'old'])
  })

  it('server trả lỗi (401/500...) -> throw với message rõ ràng, không nuốt lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(fetchSessionHistory('http://localhost:8787', 'tok-het-han')).rejects.toThrow(/401/)
  })

  it('title cache là JSON hỏng -> coi như rỗng, không throw (đúng pattern settings.ts đã dùng)', async () => {
    localStorage.setItem('agent-core-ui-session-titles', '{not valid json')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [{ id: 's1', createdAt: 1 }] }) }))
    await expect(fetchSessionHistory('http://localhost:8787', 'tok')).resolves.toBeTruthy()
  })
})
