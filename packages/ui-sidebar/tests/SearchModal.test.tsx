// @vitest-environment jsdom
//
// SearchModal (2026-08): search chuyển từ input inline trong sidebar sang
// modal giữa màn hình + debounce (chờ user NGỪNG gõ) + skeleton hiện đúng
// trong khoảng debounce đang chờ. Test render THẬT với fake timers (cùng
// pattern đã dùng cho useToasts auto-dismiss ở primitives.test.tsx) — không
// chỉ tin logic đúng vì code "trông hợp lý".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SearchModal } from '../src/SearchModal.tsx'
import type { SessionSummary } from '../src/sessionHistory.ts'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)

const sessions: SessionSummary[] = [
  { id: 's1', createdAt: 1, title: 'giá vàng SJC hôm nay bao nhiêu', driver: 'default' },
  { id: 's2', createdAt: 2, title: 'khiếu nại sự cố mạng', driver: 'default' },
  { id: 's3', createdAt: 3, title: 'viết báo cáo tuần', driver: 'default' },
]

describe('SearchModal', () => {
  it('vừa mở, chưa gõ gì -> hiện đủ session ngay, KHÔNG hiện skeleton', () => {
    render(<SearchModal open sessions={sessions} onClose={vi.fn()} onSelectSession={vi.fn()} />)

    expect(screen.getByText('giá vàng SJC hôm nay bao nhiêu')).toBeTruthy()
    expect(screen.getByText('viết báo cáo tuần')).toBeTruthy()
    const resultsRegion = screen.getByText('viết báo cáo tuần').closest('[aria-busy]') as HTMLElement
    expect(resultsRegion.getAttribute('aria-busy')).toBe('false')
  })

  it('gõ vào -> hiện skeleton NGAY (đang chờ debounce), chưa lọc list vội', async () => {
    vi.useFakeTimers()
    render(<SearchModal open sessions={sessions} onClose={vi.fn()} onSelectSession={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Tìm cuộc trò chuyện...'), { target: { value: 'khiếu nại' } })

    // aria-busy="true" trên khung kết quả trong lúc debounce đang chờ.
    const resultsRegion = screen.getByText('Đang tìm kiếm…').closest('[aria-busy]') as HTMLElement
    expect(resultsRegion.getAttribute('aria-busy')).toBe('true')
    // Session không khớp KHÔNG được ẩn đi ngay lập tức nếu vẫn còn hiện (list
    // thật đã bị thay bằng skeleton, không phải lọc nửa vời).
    expect(screen.queryByText('viết báo cáo tuần')).toBeNull()

    vi.useRealTimers()
  })

  it('sau khi debounce hết hạn -> lọc đúng theo title, không phân biệt hoa/thường', async () => {
    vi.useFakeTimers()
    render(<SearchModal open sessions={sessions} onClose={vi.fn()} onSelectSession={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Tìm cuộc trò chuyện...'), { target: { value: 'KHIẾU NẠI' } })

    await act(async () => {
      vi.advanceTimersByTime(350)
    })

    expect(screen.getByText('khiếu nại sự cố mạng')).toBeTruthy()
    expect(screen.queryByText('giá vàng SJC hôm nay bao nhiêu')).toBeNull()
    expect(screen.queryByText('viết báo cáo tuần')).toBeNull()

    vi.useRealTimers()
  })

  it('debounce hết hạn, không khớp session nào -> thông báo rỗng', async () => {
    vi.useFakeTimers()
    render(<SearchModal open sessions={sessions} onClose={vi.fn()} onSelectSession={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Tìm cuộc trò chuyện...'), { target: { value: 'không tồn tại đâu' } })
    await act(async () => {
      vi.advanceTimersByTime(350)
    })

    expect(screen.getByText('Không tìm thấy cuộc trò chuyện nào phù hợp')).toBeTruthy()
    vi.useRealTimers()
  })

  it('click 1 kết quả -> onSelectSession(id) đúng + onClose() được gọi', () => {
    const onSelectSession = vi.fn()
    const onClose = vi.fn()
    render(<SearchModal open sessions={sessions} onClose={onClose} onSelectSession={onSelectSession} />)

    fireEvent.click(screen.getByText('viết báo cáo tuần'))

    expect(onSelectSession).toHaveBeenCalledWith('s3')
    expect(onClose).toHaveBeenCalled()
  })

  it('bấm nút X cuối ô input -> onClose() được gọi', () => {
    const onClose = vi.fn()
    render(<SearchModal open sessions={sessions} onClose={onClose} onSelectSession={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Đóng tìm kiếm'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('click ra ngoài (backdrop) -> onClose() được gọi; click trong nội dung modal thì KHÔNG', () => {
    const onClose = vi.fn()
    render(<SearchModal open sessions={sessions} onClose={onClose} onSelectSession={vi.fn()} />)

    fireEvent.click(screen.getByPlaceholderText('Tìm cuộc trò chuyện...'))
    expect(onClose).not.toHaveBeenCalled()

    const dialog = screen.getByPlaceholderText('Tìm cuộc trò chuyện...').closest('dialog') as HTMLDialogElement
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
