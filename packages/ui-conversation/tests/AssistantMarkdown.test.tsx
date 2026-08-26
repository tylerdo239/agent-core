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
import styles from '../src/AssistantMarkdown.module.css'

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
    const list = document.querySelector(`.${styles.markdown} ul`)
    expect(list).toBeTruthy()
    expect(list?.querySelectorAll('li').length).toBe(2)
    expect(screen.getByText(/Mua vào/).closest('li')).toBeTruthy()
  })

  it('code block render qua <pre><code>, giữ nguyên nội dung không escape sai', () => {
    render(<AssistantMarkdown content={'```\nconst x = 1\n```'} />)
    const codeBlock = document.querySelector(`.${styles.markdown} pre code`)
    expect(codeBlock?.textContent?.trim()).toBe('const x = 1')
  })

  it('text thường không có markdown vẫn render đúng nguyên văn (không throw, không mất nội dung)', () => {
    render(<AssistantMarkdown content="Xin chào, tôi có thể giúp gì cho bạn?" />)
    expect(screen.getByText('Xin chào, tôi có thể giúp gì cho bạn?')).toBeTruthy()
  })

  // Bug thật user báo (2026-08): bảng markdown (cú pháp GFM) không vẽ được
  // thành bảng — react-markdown mặc định chỉ parse CommonMark thuần, không
  // hỗ trợ bảng, cần remark-gfm. Verify render ra <table> thật, không phải
  // còn nguyên văn bản `| a | b |` thô.
  it('bảng markdown (GFM) render ra <table>/<th>/<td> thật, không còn cú pháp | | thô', () => {
    const content = ['| Tên | Giá |', '| --- | --- |', '| Cà phê | 30.000 |', '| Trà sữa | 25.000 |'].join('\n')
    render(<AssistantMarkdown content={content} />)

    const table = document.querySelector(`.${styles.markdown} table`)
    expect(table).toBeTruthy()
    expect(table?.querySelectorAll('th').length).toBe(2)
    expect(screen.getByText('Tên').tagName).toBe('TH')
    expect(screen.getByText('Cà phê').closest('td')).toBeTruthy()
    expect(screen.getByText('25.000').closest('td')).toBeTruthy()
    expect(screen.queryByText(/---/)).toBeNull()
  })
})
