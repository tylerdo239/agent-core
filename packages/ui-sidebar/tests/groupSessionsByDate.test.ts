// Verify THẬT logic gom nhóm theo ngày — `now` truyền tường minh để test
// xác định (deterministic), không phụ thuộc đồng hồ thật lúc chạy.
import { describe, expect, it } from 'vitest'
import { groupSessionsByDate } from '../src/groupSessionsByDate.ts'
import type { SessionSummary } from '../src/sessionHistory.ts'

// Cố định "bây giờ" = 20/08/2026 15:00.
const NOW = new Date(2026, 7, 20, 15, 0, 0)

function at(daysAgo: number, hour = 10): number {
  return new Date(2026, 7, 20 - daysAgo, hour, 0, 0).getTime()
}

function session(id: string, createdAt: number): SessionSummary {
  return { id, createdAt, title: `session ${id}`, driver: 'default' }
}

describe('groupSessionsByDate', () => {
  it('cùng ngày hôm nay -> nhóm "Hôm nay"', () => {
    const groups = groupSessionsByDate([session('a', at(0, 9)), session('b', at(0, 14))], NOW)
    expect(groups).toEqual([{ label: 'Hôm nay', sessions: [session('a', at(0, 9)), session('b', at(0, 14))] }])
  })

  it('hôm qua -> nhóm "Hôm qua" (khác nhóm "Hôm nay")', () => {
    const groups = groupSessionsByDate([session('a', at(0)), session('b', at(1))], NOW)
    expect(groups.map((g) => g.label)).toEqual(['Hôm nay', 'Hôm qua'])
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['b'])
  })

  it('cũ hơn hôm qua -> nhãn theo ngày cụ thể dd/MM (cùng năm hiện tại, không kèm năm)', () => {
    const groups = groupSessionsByDate([session('a', at(5))], NOW)
    expect(groups).toEqual([{ label: '15/08', sessions: [session('a', at(5))] }])
  })

  it('khác năm -> nhãn kèm năm (dd/MM/yyyy)', () => {
    const lastYear = new Date(2025, 11, 31, 10, 0, 0).getTime()
    const groups = groupSessionsByDate([session('a', lastYear)], NOW)
    expect(groups).toEqual([{ label: '31/12/2025', sessions: [session('a', lastYear)] }])
  })

  it('giữ đúng thứ tự nhóm theo thứ tự lần đầu gặp trong mảng đầu vào (mới nhất trước)', () => {
    const groups = groupSessionsByDate(
      [session('today', at(0)), session('yesterday', at(1)), session('old', at(5)), session('today-2', at(0))],
      NOW,
    )
    expect(groups.map((g) => g.label)).toEqual(['Hôm nay', 'Hôm qua', '15/08'])
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['today', 'today-2'])
  })

  it('rỗng -> mảng nhóm rỗng', () => {
    expect(groupSessionsByDate([], NOW)).toEqual([])
  })
})
