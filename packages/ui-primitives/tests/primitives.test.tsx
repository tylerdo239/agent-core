// @vitest-environment jsdom
//
// Verify THẬT từng component design-system mới (Modal/Tooltip/Toast/Pill/
// StateDot) — không chỉ tin "chắc render được" vì build/typecheck xanh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Button } from '../src/Button.tsx'
import { Modal } from '../src/Modal.tsx'
import { Tooltip } from '../src/Tooltip.tsx'
import { Pill } from '../src/Pill.tsx'
import { StateDot } from '../src/StateDot.tsx'
import { useToasts, ToastContainer } from '../src/Toast.tsx'

// jsdom không implement HTMLDialogElement.showModal()/close() -- cùng giới
// hạn môi trường test đã gặp ở apps/web/tests/App.smoke.test.tsx, KHÔNG
// phải bug của Modal.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)

describe('Button (chuyển từ apps/web sang package dùng chung)', () => {
  it('render đúng nội dung, variant="primary" có class riêng', () => {
    render(<Button variant="primary">Gửi</Button>)
    const btn = screen.getByText('Gửi')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.className).toContain('primary')
  })

  it('disabled -> không nhận click', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        x
      </Button>,
    )
    fireEvent.click(screen.getByText('x'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Modal', () => {
  it('open=false -> dialog KHÔNG mở', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>nội dung</p>
      </Modal>,
    )
    const dialog = document.querySelector('dialog')
    expect(dialog?.open).toBe(false)
  })

  it('open=true -> dialog mở, hiện đúng children', async () => {
    await act(async () => {
      render(
        <Modal open onClose={() => {}}>
          <p>nội dung modal</p>
        </Modal>,
      )
    })
    const dialog = document.querySelector('dialog')
    expect(dialog?.open).toBe(true)
    expect(screen.getByText('nội dung modal')).toBeTruthy()
  })

  it('đổi open true -> false -> dialog tự đóng lại (useEffect phản ứng đúng theo prop)', async () => {
    const { rerender } = render(
      <Modal open onClose={() => {}}>
        <p>x</p>
      </Modal>,
    )
    await act(async () => {})
    expect(document.querySelector('dialog')?.open).toBe(true)

    await act(async () => {
      rerender(
        <Modal open={false} onClose={() => {}}>
          <p>x</p>
        </Modal>,
      )
    })
    expect(document.querySelector('dialog')?.open).toBe(false)
  })
})

describe('Tooltip', () => {
  it('label nằm trong DOM (role="tooltip"), đi kèm children', () => {
    render(
      <Tooltip label="Cấu hình kết nối">
        <button>⚙</button>
      </Tooltip>,
    )
    expect(screen.getByText('⚙')).toBeTruthy()
    expect(screen.getByRole('tooltip').textContent).toBe('Cấu hình kết nối')
  })
})

describe('Pill', () => {
  it('tone="success" -> có class success', () => {
    render(<Pill tone="success">đã kết nối</Pill>)
    const pill = screen.getByText('đã kết nối')
    expect(pill.className).toContain('success')
  })

  it('tone mặc định (neutral) -> KHÔNG thêm class tone nào', () => {
    render(<Pill>trung tính</Pill>)
    const pill = screen.getByText('trung tính')
    // chỉ có đúng 1 class (pill gốc), không có success/error/accent
    expect(pill.className.trim().split(/\s+/).length).toBe(1)
  })
})

describe('StateDot', () => {
  it('variant="connected" -> class connected, có role=status khi có label', () => {
    render(<StateDot variant="connected" label="đã kết nối" />)
    const dot = screen.getByRole('status')
    expect(dot.className).toContain('connected')
    expect(dot.getAttribute('aria-label')).toBe('đã kết nối')
  })

  it('không truyền label -> không có role (chấm thuần trang trí, tránh nhiễu screen reader)', () => {
    const { container } = render(<StateDot variant="error" />)
    const dot = container.querySelector('span')
    expect(dot?.getAttribute('role')).toBeNull()
  })
})

describe('useToasts / ToastContainer', () => {
  function Harness({ autoDismissMs }: { autoDismissMs: number }) {
    const { toasts, push } = useToasts(autoDismissMs)
    return (
      <div>
        <button onClick={() => push('lỗi kết nối', 'error')}>trigger</button>
        <ToastContainer toasts={toasts} />
      </div>
    )
  }

  it('push() thêm toast hiện ra, không có toast nào lúc đầu', () => {
    render(<Harness autoDismissMs={5000} />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByText('trigger'))
    expect(screen.getByText('lỗi kết nối')).toBeTruthy()
  })

  it('toast tự biến mất sau autoDismissMs', async () => {
    vi.useFakeTimers()
    render(<Harness autoDismissMs={100} />)
    fireEvent.click(screen.getByText('trigger'))
    expect(screen.getByText('lỗi kết nối')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    expect(screen.queryByText('lỗi kết nối')).toBeNull()
    vi.useRealTimers()
  })
})
