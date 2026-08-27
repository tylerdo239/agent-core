// @vitest-environment jsdom
//
// Follow-up (2026-08): chọn skill kiểu slash-command — gõ "/" ở đầu ô nhập
// mở popup lọc theo tên/mô tả, dùng CHUNG cho mọi driver (thay
// SkillComposerExtra cũ, RLM-only, xem packages/ui-rlm-workspace). Test qua
// wrapper có state thật (Composer là controlled component 100% — fireEvent
// .change không tự cập nhật lại `value` nếu không có state cha thật đứng sau).
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Composer, type SkillOption } from '../src/Composer.tsx'

const SKILLS: SkillOption[] = [
  { name: 'data-scientist', description: 'Phân tích dữ liệu tổng quát' },
  { name: 'sql-to-insights', description: 'Truy vấn SQL và diễn giải' },
  { name: 'time-series-analysis', description: 'Phân tích chuỗi thời gian' },
]

function Harness({ onSelectSkill = vi.fn(), initialSkill = '' }: { onSelectSkill?: (name: string) => void; initialSkill?: string }) {
  const [value, setValue] = useState('')
  const [selectedSkill, setSelectedSkill] = useState(initialSkill)
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={(e) => e.preventDefault()}
      disabled={false}
      skills={SKILLS}
      selectedSkill={selectedSkill}
      onSelectSkill={(name) => { setSelectedSkill(name); onSelectSkill(name) }}
    />
  )
}

afterEach(cleanup)

describe('Composer — chọn skill kiểu slash-command', () => {
  it('gõ "/" mở popup lọc theo tên và mô tả, không mở khi không có "/"', () => {
    render(<Harness />)
    const textarea = screen.getByPlaceholderText('Nhắn gì đó cho agent...')

    fireEvent.change(textarea, { target: { value: 'hello' } })
    expect(screen.queryByRole('listbox', { name: 'Chọn skill' })).toBeNull()

    fireEvent.change(textarea, { target: { value: '/time' } })
    expect(screen.getByRole('listbox', { name: 'Chọn skill' })).toBeTruthy()
    expect(screen.getByText('time-series-analysis')).toBeTruthy()
    expect(screen.queryByText('data-scientist')).toBeNull()

    // Lọc theo MÔ TẢ cũng khớp, không chỉ tên.
    fireEvent.change(textarea, { target: { value: '/SQL' } })
    expect(screen.getByText('sql-to-insights')).toBeTruthy()
  })

  it('click chọn skill: set selectedSkill, xoá text ô nhập, đóng popup', () => {
    const onSelectSkill = vi.fn()
    render(<Harness onSelectSkill={onSelectSkill} />)
    const textarea = screen.getByPlaceholderText('Nhắn gì đó cho agent...') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: '/data' } })
    fireEvent.mouseDown(screen.getByText('data-scientist'))

    expect(onSelectSkill).toHaveBeenCalledWith('data-scientist')
    expect(textarea.value).toBe('')
    expect(screen.queryByRole('listbox', { name: 'Chọn skill' })).toBeNull()
    expect(screen.getByText('/data-scientist')).toBeTruthy() // chip skill đã chọn
  })

  it('bàn phím: ArrowDown di chuyển active option, Enter chọn (không submit form)', () => {
    const onSelectSkill = vi.fn()
    render(<Harness onSelectSkill={onSelectSkill} />)
    const textarea = screen.getByPlaceholderText('Nhắn gì đó cho agent...')

    fireEvent.change(textarea, { target: { value: '/' } }) // mở popup, khớp cả 3 skill
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSelectSkill).toHaveBeenCalledWith('time-series-analysis') // index 2 sau 2 lần ArrowDown
  })

  it('Escape đóng popup bằng cách xoá nội dung ô nhập', () => {
    render(<Harness />)
    const textarea = screen.getByPlaceholderText('Nhắn gì đó cho agent...') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: '/data' } })
    expect(screen.getByRole('listbox', { name: 'Chọn skill' })).toBeTruthy()
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(textarea.value).toBe('')
    expect(screen.queryByRole('listbox', { name: 'Chọn skill' })).toBeNull()
  })

  it('bỏ chọn skill bằng nút X trên chip', () => {
    const onSelectSkill = vi.fn()
    render(<Harness onSelectSkill={onSelectSkill} initialSkill="data-scientist" />)

    expect(screen.getByText('/data-scientist')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Bỏ chọn skill data-scientist'))
    expect(onSelectSkill).toHaveBeenCalledWith('')
    expect(screen.queryByText('/data-scientist')).toBeNull()
  })

  it('không gõ "/" — Enter vẫn submit form như trước (hành vi cũ không đổi)', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    function SubmitHarness() {
      const [value, setValue] = useState('xin chao')
      return (
        <Composer value={value} onChange={setValue} onSubmit={onSubmit} disabled={false}
          skills={SKILLS} selectedSkill="" onSelectSkill={() => {}} />
      )
    }
    render(<SubmitHarness />)
    fireEvent.keyDown(screen.getByPlaceholderText('Nhắn gì đó cho agent...'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalled()
  })
})
