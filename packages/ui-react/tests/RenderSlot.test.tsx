// @vitest-environment jsdom
//
// Phase 9.3 deliverable: RenderSlot render đúng component của entry đã đăng
// ký; render fallback khi không có entry khớp; register/unregister LÚC APP
// ĐANG CHẠY (mô phỏng hot-swap 1 UI-plugin) làm UI tự chuyển qua lại KHÔNG
// cần remount cây React cha — đây là phép thử thật cho tinh thần chaos test
// Phase 5, áp dụng cho tầng UI thay vì loop driver.
//
// `// @vitest-environment jsdom` chỉ áp dụng cho FILE NÀY — không đổi
// environment mặc định (node) của 58 test còn lại trong repo, tránh làm
// chậm/thay đổi hành vi test không liên quan tới DOM.
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import * as uiSlots from '@agent-core/ui-slots'
import { RenderSlot } from '../src/RenderSlot.tsx'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

// Project chưa bật `test.globals`/setupFiles cho RTL nên KHÔNG tự cleanup
// DOM giữa các it() trong cùng file — không gọi cleanup() thì DOM của test
// trước còn sót lại, `screen.getByTestId` match nhiều node cùng lúc và fail
// sai lý do (verify thực nghiệm, không suy đoán — đã gặp lỗi này thật).
afterEach(cleanup)

interface Owner {
  toolCall: { name: string; args: Record<string, unknown> }
}

function Fallback({ toolCall }: Owner) {
  return <div data-testid="fallback">fallback: {toolCall.name}</div>
}

describe('Phase 9.3 — RenderSlot', () => {
  it('có entry đăng ký đúng key -> render component của entry đó, KHÔNG render fallback', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(uiSlots)
    await settle()
    await fiber.await()
    ctx.slots.declare('tool.call.toolview', 'keyed')

    function WebSearchCard({ toolCall }: Owner) {
      return <div data-testid="web-search-card">query: {String(toolCall.args.query)}</div>
    }
    ctx.slots.register('tool.call.toolview', { key: 'web_search', component: WebSearchCard })

    render(
      <RenderSlot<Owner>
        ctx={ctx}
        name="tool.call.toolview"
        entryKey="web_search"
        owner={{ toolCall: { name: 'web_search', args: { query: 'giá vàng' } } }}
        fallback={Fallback}
      />,
    )

    expect(screen.getByTestId('web-search-card')).toBeTruthy()
    expect(screen.queryByTestId('fallback')).toBeNull()
    expect(screen.getByTestId('web-search-card').textContent).toContain('giá vàng')

    await fiber.dispose()
  })

  it('KHÔNG có entry khớp entryKey -> render fallback, không throw', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(uiSlots)
    await settle()
    await fiber.await()
    ctx.slots.declare('tool.call.toolview', 'keyed')
    // Không đăng ký gì cho 'query_database' — đúng tình huống "tool không có UI-plugin riêng".

    render(
      <RenderSlot<Owner>
        ctx={ctx}
        name="tool.call.toolview"
        entryKey="query_database"
        owner={{ toolCall: { name: 'query_database', args: {} } }}
        fallback={Fallback}
      />,
    )

    expect(screen.getByTestId('fallback')).toBeTruthy()
    expect(screen.getByTestId('fallback').textContent).toContain('query_database')

    await fiber.dispose()
  })

  it('unmount UI-plugin LÚC ĐANG CHẠY (hot-swap tầng UI) -> tự chuyển sang fallback, KHÔNG cần remount cây React cha', async () => {
    const ctx = new Context()
    const rootFiber = ctx.plugin(uiSlots)
    await settle()
    await rootFiber.await()
    ctx.slots.declare('tool.call.toolview', 'keyed')

    function WebSearchCard({ toolCall }: Owner) {
      return <div data-testid="web-search-card">query: {String(toolCall.args.query)}</div>
    }
    // UI-plugin đăng ký qua 1 fiber CON riêng (giống 1 bundle UI-plugin thật
    // mount/unmount độc lập) — không phải đăng ký thẳng vào root. `inject:
    // ['slots']` bắt buộc (coding rule A3) — thiếu là throw "cannot get
    // property without inject" dù ctx.slots đang sống bình thường ở root.
    const webSearchUiPlugin = Object.assign(
      (pluginCtx: Context) => {
        pluginCtx.effect(() => pluginCtx.slots.register('tool.call.toolview', { key: 'web_search', component: WebSearchCard }))
      },
      { inject: ['slots'] },
    )
    const pluginFiber = ctx.plugin(webSearchUiPlugin)
    await settle()
    await pluginFiber.await()

    const view = render(
      <RenderSlot<Owner>
        ctx={ctx}
        name="tool.call.toolview"
        entryKey="web_search"
        owner={{ toolCall: { name: 'web_search', args: { query: 'giá vàng' } } }}
        fallback={Fallback}
      />,
    )
    expect(screen.getByTestId('web-search-card')).toBeTruthy()

    // Gỡ UI-plugin GIỮA LÚC app đang chạy — KHÔNG remount cây React (`view`
    // vẫn là cùng 1 lần render() ban đầu, không gọi render()/rerender() lại).
    await act(async () => {
      await pluginFiber.dispose()
      await settle()
    })

    expect(screen.queryByTestId('web-search-card')).toBeNull()
    expect(screen.getByTestId('fallback')).toBeTruthy()

    view.unmount()
    await rootFiber.dispose()
  })
})
