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
import { SourceList } from '../src/SourceList.tsx'
import { Skeleton } from '../src/Skeleton.tsx'
import { TextField } from '../src/TextField.tsx'
import { Textarea } from '../src/Textarea.tsx'
import { Select } from '../src/Select.tsx'

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

  it('click thẳng vào dialog (backdrop) -> onClose(); click vào children -> KHÔNG đóng', async () => {
    const onClose = vi.fn()
    await act(async () => {
      render(
        <Modal open onClose={onClose}>
          <p>nội dung modal</p>
        </Modal>,
      )
    })
    const dialog = document.querySelector('dialog') as HTMLDialogElement

    fireEvent.click(screen.getByText('nội dung modal'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('className truyền vào được gắn thêm (không thay thế) class .dialog gốc', async () => {
    await act(async () => {
      render(
        <Modal open onClose={() => {}} className="custom-position">
          <p>x</p>
        </Modal>,
      )
    })
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('custom-position')
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

describe('SourceList', () => {
  const results = [
    { title: 'Nguồn A', url: 'https://a.example/', snippet: 'mô tả A' },
    { url: 'https://b.example/', snippet: 'mô tả B' },
  ]

  it('rỗng -> hiện đúng 1 dòng "không tìm thấy kết quả"', () => {
    render(<SourceList results={[]} />)
    expect(screen.getByText('không tìm thấy kết quả')).toBeTruthy()
  })

  it('title thiếu -> label rơi về hostname', () => {
    render(<SourceList results={results} />)
    expect(screen.getByText('Nguồn A')).toBeTruthy()
    expect(screen.getByText('b.example')).toBeTruthy()
  })

  it('collapsibleSnippets=false (mặc định) -> snippet hiện tĩnh, không có nút toggle', () => {
    render(<SourceList results={results} />)
    expect(screen.getByText('mô tả A')).toBeTruthy()
    expect(screen.queryByText('xem mô tả')).toBeNull()
  })

  it('collapsibleSnippets=true -> snippet ẩn mặc định, click "xem mô tả" mới hiện', () => {
    render(<SourceList results={results} collapsibleSnippets />)
    expect(screen.queryByText('mô tả A')).toBeNull()
    fireEvent.click(screen.getAllByText('xem mô tả')[0])
    expect(screen.getByText('mô tả A')).toBeTruthy()
    fireEvent.click(screen.getByText('ẩn mô tả'))
    expect(screen.queryByText('mô tả A')).toBeNull()
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

describe('Skeleton', () => {
  it('render đúng số dòng yêu cầu, thuần trang trí (aria-hidden)', () => {
    const { container } = render(<Skeleton rows={4} />)
    const wrap = container.firstChild as HTMLElement
    expect(wrap.getAttribute('aria-hidden')).toBe('true')
    expect(wrap.children.length).toBe(4)
  })

  it('mặc định 3 dòng khi không truyền rows', () => {
    const { container } = render(<Skeleton />)
    expect((container.firstChild as HTMLElement).children.length).toBe(3)
  })
})

describe('TextField', () => {
  it('gõ vào input -> onChange nhận đúng giá trị', () => {
    const onChange = vi.fn()
    render(<TextField label="Tên đăng nhập" value="" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'alice' } })
    expect(onChange).toHaveBeenCalledWith('alice')
  })

  it('có error -> hiện dòng lỗi + aria-invalid', () => {
    render(<TextField label="Mật khẩu" value="" onChange={vi.fn()} error="Mật khẩu quá ngắn" />)
    expect(screen.getByText('Mật khẩu quá ngắn')).toBeTruthy()
    expect(screen.getByLabelText('Mật khẩu').getAttribute('aria-invalid')).toBe('true')
  })

  it('không có error -> KHÔNG có aria-invalid', () => {
    render(<TextField label="Mật khẩu" value="" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Mật khẩu').getAttribute('aria-invalid')).toBeNull()
  })
})

describe('Textarea', () => {
  it('gõ vào textarea -> onChange nhận đúng giá trị', () => {
    const onChange = vi.fn()
    render(<Textarea label="Nội dung" value="" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Nội dung'), { target: { value: '# Hello' } })
    expect(onChange).toHaveBeenCalledWith('# Hello')
  })

  it('có error -> hiện dòng lỗi + aria-invalid', () => {
    render(<Textarea label="Nội dung" value="" onChange={vi.fn()} error="không được rỗng" />)
    expect(screen.getByText('không được rỗng')).toBeTruthy()
    expect(screen.getByLabelText('Nội dung').getAttribute('aria-invalid')).toBe('true')
  })
})

// UI riêng theo theme (thay native <select>, không style được popup của
// nó) — user yêu cầu rõ, xem packages/ui-rlm-workspace/src/SkillComposerExtra.tsx.
describe('Select', () => {
  const options = [
    { value: 'a', label: 'Skill A', description: 'mô tả A' },
    { value: 'b', label: 'Skill B' },
  ]

  it('rỗng -> hiện placeholder; có value khớp option -> hiện đúng label', () => {
    const { rerender } = render(<Select value="" options={options} placeholder="Tự động" ariaLabel="Chọn skill" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Chọn skill' }).textContent).toContain('Tự động')

    rerender(<Select value="a" options={options} placeholder="Tự động" ariaLabel="Chọn skill" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Chọn skill' }).textContent).toContain('Skill A')
  })

  it('chưa bấm -> popup (role="listbox") KHÔNG có trong DOM', () => {
    render(<Select value="" options={options} placeholder="Tự động" ariaLabel="Chọn skill" onChange={vi.fn()} />)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('bấm trigger -> mở popup; bấm 1 option -> gọi onChange đúng value, tự đóng popup', () => {
    const onChange = vi.fn()
    render(<Select value="" options={options} placeholder="Tự động" ariaLabel="Chọn skill" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Chọn skill' }))
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.mouseDown(screen.getByText('Skill B'))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('bấm ra ngoài -> đóng popup, KHÔNG gọi onChange', () => {
    const onChange = vi.fn()
    render(
      <div>
        <Select value="" options={options} placeholder="Tự động" ariaLabel="Chọn skill" onChange={onChange} />
        <button>ngoài</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Chọn skill' }))
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.mouseDown(screen.getByText('ngoài'))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('phím Escape đóng popup', () => {
    render(<Select value="" options={options} placeholder="Tự động" ariaLabel="Chọn skill" onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Chọn skill' })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('bàn phím: ArrowDown mở popup, ArrowDown/Enter chọn đúng option', () => {
    const onChange = vi.fn()
    render(<Select value="" options={options} placeholder="Tự động" ariaLabel="Chọn skill" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Chọn skill' })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // active: a (0) -> b (1)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('disabled -> bấm trigger KHÔNG mở popup', () => {
    render(<Select value="" options={options} placeholder="Tự động" ariaLabel="Chọn skill" disabled onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chọn skill' }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
