// @vitest-environment jsdom
//
// UI redesign (2026-08): sidebar top row — logo + collapse (đã có sẵn) +
// search. Search follow-up thứ 2: đổi từ input mở rộng ngay trong sidebar
// sang mở SearchModal (modal giữa màn hình) — coverage chi tiết cho search
// (debounce/skeleton/filter/chọn kết quả) nằm ở SearchModal.test.tsx riêng,
// file này chỉ verify Sidebar mở đúng modal đó khi bấm icon.
//
// Module auth (nhiều người dùng thật): footer thêm username/đăng xuất +
// trigger "Quản lý người dùng" (chỉ hiện khi isAdmin).
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Sidebar } from '../src/Sidebar.tsx'
import type { SessionSummary } from '../src/sessionHistory.ts'

// jsdom không implement HTMLDialogElement.showModal()/close() — Sidebar giờ
// luôn render SearchModal (Modal bên trong), cùng giới hạn môi trường test
// đã gặp ở App.smoke.test.tsx/primitives.test.tsx, không phải bug Modal.
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
]

function renderSidebar(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar
      sessions={sessions}
      activeSessionId={null}
      onNewChat={vi.fn()}
      onNewDataSession={vi.fn()}
      onSelectSession={vi.fn()}
      isAdmin={false}
      onOpenAdminPanel={vi.fn()}
      onOpenPluginInventory={vi.fn()}
      onOpenPluginSettings={vi.fn()}
      currentUsername="alice"
      onLogout={vi.fn()}
      {...overrides}
    />,
  )
}

describe('Sidebar — logo + collapse + search trigger', () => {
  it('logo + wordmark hiện khi mở rộng', () => {
    renderSidebar()
    expect(screen.getByText('Fox Harness')).toBeTruthy()
  })

  it('danh sách lịch sử hiện đủ, KHÔNG lọc gì (lọc là việc của SearchModal)', () => {
    renderSidebar()
    // Scope vào ĐÚNG nav lịch sử của Sidebar — SearchModal (luôn có trong DOM,
    // chỉ ẩn qua thuộc tính `open` của <dialog>) cũng render y hệt list
    // session này trong nội dung ban đầu của nó, getByText không scope sẽ
    // throw "multiple elements found".
    const historyNav = screen.getByRole('navigation', { name: 'Lịch sử hội thoại' })
    expect(within(historyNav).getByText('giá vàng SJC hôm nay bao nhiêu')).toBeTruthy()
    expect(within(historyNav).getByText('khiếu nại sự cố mạng')).toBeTruthy()
  })

  it('nhóm lịch sử theo ngày — session tạo hôm nay hiện dưới nhãn "Hôm nay"', () => {
    renderSidebar({ sessions: [{ id: 's-today', createdAt: Date.now(), title: 'câu hỏi vừa tạo', driver: 'default' }] })
    const historyNav = screen.getByRole('navigation', { name: 'Lịch sử hội thoại' })
    expect(within(historyNav).getByText('Hôm nay')).toBeTruthy()
    expect(within(historyNav).getByText('câu hỏi vừa tạo')).toBeTruthy()
  })

  it('SearchModal đóng mặc định, bấm icon 🔍 -> mở modal search thật (dialog.open = true)', () => {
    renderSidebar()
    const dialogBefore = screen.getByPlaceholderText('Tìm cuộc trò chuyện...').closest('dialog') as HTMLDialogElement
    expect(dialogBefore.open).toBe(false)

    fireEvent.click(screen.getByLabelText('Tìm cuộc trò chuyện'))

    const dialogAfter = screen.getByPlaceholderText('Tìm cuộc trò chuyện...').closest('dialog') as HTMLDialogElement
    expect(dialogAfter.open).toBe(true)
  })
})

describe('Sidebar — module auth: username/đăng xuất/admin panel', () => {
  it('hiện đúng username, bấm "Đăng xuất" -> gọi onLogout', () => {
    const onLogout = vi.fn()
    renderSidebar({ currentUsername: 'alice', onLogout })
    expect(screen.getByText('alice')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Đăng xuất'))
    expect(onLogout).toHaveBeenCalled()
  })

  it('isAdmin=false -> KHÔNG hiện trigger "Quản lý người dùng"', () => {
    renderSidebar({ isAdmin: false })
    expect(screen.queryByText('Quản lý người dùng')).toBeNull()
  })

  it('isAdmin=true -> hiện trigger "Quản lý người dùng", bấm gọi onOpenAdminPanel', () => {
    const onOpenAdminPanel = vi.fn()
    renderSidebar({ isAdmin: true, onOpenAdminPanel })
    fireEvent.click(screen.getByText('Quản lý người dùng'))
    expect(onOpenAdminPanel).toHaveBeenCalled()
  })

  it('isAdmin=false -> KHÔNG hiện trigger "Plugin đang chạy"', () => {
    renderSidebar({ isAdmin: false })
    expect(screen.queryByText('Plugin đang chạy')).toBeNull()
  })

  it('isAdmin=true -> hiện trigger "Plugin đang chạy", bấm gọi onOpenPluginInventory', () => {
    const onOpenPluginInventory = vi.fn()
    renderSidebar({ isAdmin: true, onOpenPluginInventory })
    fireEvent.click(screen.getByText('Plugin đang chạy'))
    expect(onOpenPluginInventory).toHaveBeenCalled()
  })

  it('isAdmin=false -> KHÔNG hiện trigger "Cấu hình"', () => {
    renderSidebar({ isAdmin: false })
    expect(screen.queryByText('Cấu hình', { selector: 'span' })).toBeNull()
  })

  it('isAdmin=true -> hiện trigger "Cấu hình", bấm gọi onOpenPluginSettings', () => {
    const onOpenPluginSettings = vi.fn()
    renderSidebar({ isAdmin: true, onOpenPluginSettings })
    fireEvent.click(screen.getByText('Cấu hình', { selector: 'span' }))
    expect(onOpenPluginSettings).toHaveBeenCalled()
  })
})

// docs/agent-core-rlm-web-ui-plugin-plan.md mục 6, case 4: entry point
// riêng cho session RLM + badge phân biệt trong lịch sử.
describe('Sidebar — entry point RLM (docs/agent-core-rlm-web-ui-plugin-plan.md)', () => {
  it('bấm "Phân tích dữ liệu" -> gọi onNewDataSession (KHÔNG gọi onNewChat)', () => {
    const onNewDataSession = vi.fn()
    const onNewChat = vi.fn()
    renderSidebar({ onNewDataSession, onNewChat })
    fireEvent.click(screen.getByText('Phân tích dữ liệu'))
    expect(onNewDataSession).toHaveBeenCalled()
    expect(onNewChat).not.toHaveBeenCalled()
  })

  it('session driver "rlm" hiện badge trong lịch sử; session "default" thì không', () => {
    renderSidebar({
      sessions: [
        { id: 's-rlm', createdAt: 1, title: 'phân tích doanh thu', driver: 'rlm' },
        { id: 's-default', createdAt: 2, title: 'hỏi thường', driver: 'default' },
      ],
    })
    const historyNav = screen.getByRole('navigation', { name: 'Lịch sử hội thoại' })
    const rlmItem = within(historyNav).getByText('phân tích doanh thu').closest('button')!
    const defaultItem = within(historyNav).getByText('hỏi thường').closest('button')!
    expect(rlmItem.querySelector('svg')).not.toBeNull()
    expect(defaultItem.querySelector('svg')).toBeNull()
  })
})
