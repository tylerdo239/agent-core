// @vitest-environment jsdom
//
// Follow-up (2026-08): user báo kết quả search bị ẩn ngay sau khi trả lời
// xong — ToolRow trước đây LUÔN collapsed-by-default (mọi tool, kể cả
// citations/nguồn tham khảo của web_search), phải bấm mới thấy lại. Verify
// `defaultExpanded` tự mở đúng lúc chuyển sang 'ok', KHÔNG ép mở lại nếu
// user đã tự tay đóng, và tool KHÔNG khai defaultExpanded vẫn giữ nguyên
// hành vi thu gọn cũ (không đổi hành vi ngoài phạm vi yêu cầu).
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToolRow } from '../src/ToolRow.tsx'

afterEach(cleanup)

describe('ToolRow — defaultExpanded', () => {
  it('defaultExpanded=true + state="ok" ngay từ đầu (resume session cũ) -> body hiện sẵn, không cần bấm', () => {
    render(
      <ToolRow icon="🔍" title="Tìm kiếm web" summary="3 nguồn" state="ok" defaultExpanded>
        <div>Nội dung citations</div>
      </ToolRow>,
    )
    expect(screen.getByText('Nội dung citations')).toBeTruthy()
  })

  it('defaultExpanded=true, chuyển từ "running" sang "ok" -> tự mở ra, không cần bấm', () => {
    const { rerender } = render(
      <ToolRow icon="🔍" title="Tìm kiếm web" summary="đang tìm..." state="running" defaultExpanded>
        <div>Nội dung citations</div>
      </ToolRow>,
    )
    expect(screen.queryByText('Nội dung citations')).toBeNull()

    rerender(
      <ToolRow icon="🔍" title="Tìm kiếm web" summary="3 nguồn" state="ok" defaultExpanded>
        <div>Nội dung citations</div>
      </ToolRow>,
    )
    expect(screen.getByText('Nội dung citations')).toBeTruthy()
  })

  it('defaultExpanded=true nhưng user tự bấm đóng lại -> tôn trọng lựa chọn, không tự ép mở lại', () => {
    render(
      <ToolRow icon="🔍" title="Tìm kiếm web" summary="3 nguồn" state="ok" defaultExpanded>
        <div>Nội dung citations</div>
      </ToolRow>,
    )
    expect(screen.getByText('Nội dung citations')).toBeTruthy()

    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Nội dung citations')).toBeNull()
  })

  it('defaultExpanded=false (mặc định, hành vi cũ) -> vẫn collapsed dù state="ok", phải bấm mới thấy', () => {
    render(
      <ToolRow icon="🗄️" title="Tra dữ liệu" summary="OK" state="ok">
        <div>Kết quả query</div>
      </ToolRow>,
    )
    expect(screen.queryByText('Kết quả query')).toBeNull()

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Kết quả query')).toBeTruthy()
  })
})
