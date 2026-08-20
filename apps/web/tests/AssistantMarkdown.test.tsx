// @vitest-environment jsdom
//
// Phase 10.4 deliverable: verify react-markdown THẬT render đúng — không chỉ
// tin "thư viện chắc hoạt động" vì đã cài đặt/build xanh. Model trả lời THẬT
// có markdown thật (đã xác nhận qua log chat thật Phase 8/9: "**Mức giá bán
// ra:**") — trước Phase 10.4, UI hiện nguyên dấu **/* thô, đây là bug có
// sẵn lộ ra khi đối chiếu đúng pattern dsh, không phải giả định suông.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AssistantMarkdown } from '../src/AssistantMarkdown.tsx'

afterEach(cleanup)

describe('Phase 10.4 — AssistantMarkdown', () => {
  it('**in đậm** render ra <strong>, không còn dấu ** thô', () => {
    render(<AssistantMarkdown content="Giá vàng **tăng mạnh** hôm nay." />)
    const strong = screen.getByText('tăng mạnh')
    expect(strong.tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('danh sách markdown render ra <ul>/<li> thật', () => {
    render(<AssistantMarkdown content={'Các mức giá:\n\n- Mua vào: 100\n- Bán ra: 105'} />)
    const list = document.querySelector('.assistant-markdown ul')
    expect(list).toBeTruthy()
    expect(list?.querySelectorAll('li').length).toBe(2)
    expect(screen.getByText(/Mua vào/).closest('li')).toBeTruthy()
  })

  it('code block render qua <pre><code>, giữ nguyên nội dung không escape sai', () => {
    render(<AssistantMarkdown content={'```\nconst x = 1\n```'} />)
    const codeBlock = document.querySelector('.assistant-markdown pre code')
    expect(codeBlock?.textContent?.trim()).toBe('const x = 1')
  })

  it('text thường không có markdown vẫn render đúng nguyên văn (không throw, không mất nội dung)', () => {
    render(<AssistantMarkdown content="Xin chào, tôi có thể giúp gì cho bạn?" />)
    expect(screen.getByText('Xin chào, tôi có thể giúp gì cho bạn?')).toBeTruthy()
  })
})
