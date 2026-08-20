// @vitest-environment jsdom
//
// Phase 9.4 smoke test: render <App/> THẬT trong jsdom (không mock React,
// không mock Cordis) — verify toàn bộ dây chuyền async thật sự chạy được:
// createClientContext() (mount ctx.slots, await fiber.await()) resolve
// đúng, App không throw, mở đúng settings dialog khi chưa có API key (đúng
// hành vi app.js cũ, xem "Khởi động" cuối file đó). Đây là verify tự động
// bổ sung cho "regression test thủ công" mà deliverable 9.4 yêu cầu — không
// thay thế, chỉ bắt sớm lỗi runtime rõ ràng (vd. bug ctx.slots chưa sẵn sàng
// đồng bộ đã phát hiện lúc viết client-context.ts) trước khi cần mở trình
// duyệt thật.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/App.tsx'

// jsdom tạo đúng HTMLDialogElement cho thẻ <dialog> nhưng KHÔNG implement
// showModal()/close() (hỗ trợ 1 phần spec Dialog) -- cùng lý do như
// scrollIntoView bên dưới: đây là giới hạn môi trường test, mọi trình duyệt
// thật đều có đủ 2 method này. Stub set/xoá `open` để giả lập đúng hành vi
// thật (assertion `dialog.open` trong test dưới cần giá trị phản ánh đúng).
beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)

describe('Phase 9.4 — App smoke test', () => {
  it('render không throw; chưa có API key -> tự mở settings dialog (đúng hành vi app.js cũ)', async () => {
    await act(async () => {
      render(<App />)
      // Chờ createClientContext() (async thật, mount ctx.slots qua Cordis) resolve.
      await new Promise((r) => setTimeout(r, 20))
    })

    await waitFor(() => {
      const dialog = document.querySelector('dialog') as HTMLDialogElement | null
      expect(dialog?.open).toBe(true)
    })
    // getByRole('heading', ...) chứ không phải getByText() thô -- sau khi
    // thêm <Tooltip label="Cấu hình kết nối"> (audit UI-primitives), text
    // này xuất hiện Ở 2 CHỖ (heading dialog + tooltip bubble của nút ⚙),
    // getByText thô sẽ throw "multiple elements found". Query theo role mới
    // đúng ý định thật của assertion: "dialog đã mở, heading của nó hiện".
    expect(screen.getByRole('heading', { name: 'Cấu hình kết nối' })).toBeTruthy()
  })

  it('có API key sẵn trong localStorage -> KHÔNG mở settings dialog, tự thử kết nối', async () => {
    localStorage.setItem(
      'agent-core-ui-settings',
      JSON.stringify({ restUrl: 'http://localhost:8787', wsUrl: 'ws://localhost:8788', apiKey: 'fake-key-for-smoke-test' }),
    )

    // jsdom có WebSocket thật (thử connect thật tới ws://localhost:8788) —
    // không có server nào lắng nghe cổng đó trong test này nên sẽ tự
    // fail/close, nhưng KHÔNG được làm render() throw — đúng điều cần verify.
    await act(async () => {
      render(<App />)
      await new Promise((r) => setTimeout(r, 20))
    })

    const dialog = document.querySelector('dialog') as HTMLDialogElement | null
    expect(dialog?.open).toBe(false)
  })
})
