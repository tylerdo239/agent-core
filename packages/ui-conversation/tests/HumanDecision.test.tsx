// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HumanDecision } from '../src/HumanDecision.tsx'

afterEach(cleanup)

describe('HumanDecision', () => {
  it('renders backend options and sends the selected answer', () => {
    const onAnswer = vi.fn()
    render(<HumanDecision question="Chọn kiểu phân tích?" options={['Tổng quan', 'Xu hướng']} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByRole('button', { name: 'Xu hướng' }))
    expect(onAnswer).toHaveBeenCalledWith('Xu hướng')
    expect(screen.getByRole('button', { name: 'Khác…' })).toBeTruthy()
  })

  it('accepts a custom answer', () => {
    const onAnswer = vi.fn()
    render(<HumanDecision question="Chọn kiểu phân tích?" options={['Tổng quan', 'Xu hướng']} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByRole('button', { name: 'Khác…' }))
    fireEvent.change(screen.getByLabelText('Câu trả lời khác'), { target: { value: 'Phân tích doanh thu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }))
    expect(onAnswer).toHaveBeenCalledWith('Phân tích doanh thu')
  })
})
