// @vitest-environment jsdom
//
// Gap thật phát hiện qua audit (đối chiếu docs/agent-core-master-summary.md
// mục 7 "Error Boundary riêng từng tool-view — 1 UI lỗi không sập cả
// conversation" — chưa build trước đây). Verify THẬT: 1 component throw
// trong lúc render KHÔNG được lan ra ngoài làm crash cả cây React.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import * as uiSlots from '@agent-core/ui-slots'
import { RenderSlot } from '../src/RenderSlot.tsx'
import { SlotErrorBoundary } from '../src/SlotErrorBoundary.tsx'

afterEach(cleanup)

function BrokenComponent(): never {
  throw new Error('component thật throw lúc render')
}

function OkComponent() {
  return <div data-testid="ok">ok</div>
}

// React tự log lỗi ra console.error mặc định khi 1 boundary bắt được (kể cả
// đã catch đúng) -- stub CHỈ để output test sạch, không phải để giấu bug.
function silenceReactErrorLog() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('Gap audit-fix — SlotErrorBoundary', () => {
  it('children render bình thường -> hiện đúng children, KHÔNG hiện fallback', () => {
    render(
      <SlotErrorBoundary fallback={<span data-testid="fallback">lỗi</span>}>
        <OkComponent />
      </SlotErrorBoundary>,
    )
    expect(screen.getByTestId('ok')).toBeTruthy()
    expect(screen.queryByTestId('fallback')).toBeNull()
  })

  it('children throw lúc render -> hiện fallback, KHÔNG throw ra ngoài (không crash test/app)', () => {
    const spy = silenceReactErrorLog()
    render(
      <SlotErrorBoundary fallback={<span data-testid="fallback">lỗi</span>}>
        <BrokenComponent />
      </SlotErrorBoundary>,
    )
    expect(screen.getByTestId('fallback')).toBeTruthy()
    spy.mockRestore()
  })
})

describe('Gap audit-fix — RenderSlot tự bọc Error Boundary (không cần caller nhớ bọc riêng)', () => {
  async function bootCtx() {
    const ctx = new Context()
    const fiber = ctx.plugin(uiSlots)
    await new Promise((r) => setTimeout(r, 10))
    await fiber.await()
    ctx.slots.declare('tool.call.toolview', 'keyed')
    return { ctx, fiber }
  }

  it('UI-plugin đăng ký throw lúc render -> RenderSlot hiện errorFallback, KHÔNG crash cả cây React', async () => {
    const spy = silenceReactErrorLog()
    const { ctx, fiber } = await bootCtx()
    ctx.slots.register('tool.call.toolview', { key: 'broken_tool', component: BrokenComponent })

    render(
      <RenderSlot
        ctx={ctx}
        name="tool.call.toolview"
        entryKey="broken_tool"
        owner={{}}
        fallback={() => <div data-testid="fallback">no plugin</div>}
        errorFallback={<span data-testid="error-fallback">crash caught</span>}
      />,
    )

    expect(screen.getByTestId('error-fallback')).toBeTruthy()
    expect(screen.queryByTestId('fallback')).toBeNull() // đây là lỗi RENDER, không phải "không có entry" -- không lẫn 2 case
    spy.mockRestore()
    await fiber.dispose()
  })

  it('fallback (không phải Component riêng) throw lúc render -> vẫn bị bắt, không crash', async () => {
    const spy = silenceReactErrorLog()
    const { ctx, fiber } = await bootCtx()
    // Không đăng ký gì cho 'no_plugin_tool' -- RenderSlot dùng chính `fallback`, và lần này fallback THROW.

    render(
      <RenderSlot
        ctx={ctx}
        name="tool.call.toolview"
        entryKey="no_plugin_tool"
        owner={{}}
        fallback={BrokenComponent}
        errorFallback={<span data-testid="error-fallback">crash caught</span>}
      />,
    )

    expect(screen.getByTestId('error-fallback')).toBeTruthy()
    spy.mockRestore()
    await fiber.dispose()
  })

  it('không truyền errorFallback -> dùng default tĩnh, vẫn không crash', async () => {
    const spy = silenceReactErrorLog()
    const { ctx, fiber } = await bootCtx()
    ctx.slots.register('tool.call.toolview', { key: 'broken_tool_2', component: BrokenComponent })

    render(
      <RenderSlot
        ctx={ctx}
        name="tool.call.toolview"
        entryKey="broken_tool_2"
        owner={{}}
        fallback={() => <div data-testid="fallback">no plugin</div>}
      />,
    )

    expect(screen.getByText('Không thể hiển thị nội dung này.')).toBeTruthy()
    spy.mockRestore()
    await fiber.dispose()
  })
})
