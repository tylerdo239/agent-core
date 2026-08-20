// @vitest-environment jsdom
//
// Phase 9.5 deliverable: apps/web mount UI-plugin thật cho web_search,
// tool.call.toolview dispatch đúng key; tool KHÔNG có UI-plugin riêng
// (query_database) rơi về GenericToolCard; gỡ UI-plugin GIỮA LÚC app đang
// chạy (hot-swap tầng UI) -> rơi về fallback, không crash trang. Khác
// tests/RenderSlot.test.tsx (Phase 9.3, dùng component GIẢ để verify cơ chế
// dispatch) — test này dùng WEBSEARCHCARD THẬT, verify luôn cả tương tác cục
// bộ (toggle snippet) mà GenericToolCard không làm được.
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import * as uiSlots from '@agent-core/ui-slots'
import * as uiToolWebSearch from '../src/index.ts'
import { RenderSlot } from '@agent-core/ui-react'
import type { ToolViewOwnerProps } from '@agent-core/ui-slots'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

function GenericFallback({ toolCall }: ToolViewOwnerProps) {
  return <div data-testid="generic-fallback">fallback: {toolCall.name}</div>
}

const SEARCH_RESULT = {
  query: 'giá vàng',
  results: [
    { title: 'Nguồn A', url: 'https://a.example/', snippet: 'mô tả A' },
    { title: 'Nguồn B', url: 'https://b.example/', snippet: 'mô tả B' },
  ],
}

async function bootCtxWithPlugin() {
  const ctx = new Context()
  const slotsFiber = ctx.plugin(uiSlots)
  await settle()
  await slotsFiber.await()
  ctx.slots.declare('tool.call.toolview', 'keyed')
  const pluginFiber = ctx.plugin(uiToolWebSearch)
  await settle()
  await pluginFiber.await()
  return { ctx, pluginFiber }
}

afterEach(cleanup)

describe('Phase 9.5 — UI-plugin thật cho tool-web-search', () => {
  it('key "web_search" -> render WebSearchCard thật (không phải GenericToolCard)', async () => {
    const { ctx } = await bootCtxWithPlugin()
    const owner: ToolViewOwnerProps = {
      toolCall: { name: 'web_search', args: { query: 'giá vàng' } },
      result: SEARCH_RESULT,
      state: 'ok',
      toolUi: { icon: '🔍', label: 'Tìm kiếm web', render: 'citations' },
    }

    render(<RenderSlot ctx={ctx} name="tool.call.toolview" entryKey="web_search" owner={owner} fallback={GenericFallback} />)

    expect(screen.queryByTestId('generic-fallback')).toBeNull()
    expect(screen.getByText('Mở tất cả (2) trong tab mới')).toBeTruthy()
    expect(screen.getByText('Nguồn A')).toBeTruthy()
    expect(screen.getByText('Nguồn B')).toBeTruthy()
  })

  it('tương tác THẬT (khác GenericToolCard): click "xem mô tả" toggle snippet — state cục bộ hoạt động', async () => {
    const { ctx } = await bootCtxWithPlugin()
    const owner: ToolViewOwnerProps = {
      toolCall: { name: 'web_search', args: { query: 'giá vàng' } },
      result: SEARCH_RESULT,
      state: 'ok',
    }
    render(<RenderSlot ctx={ctx} name="tool.call.toolview" entryKey="web_search" owner={owner} fallback={GenericFallback} />)

    expect(screen.queryByText('mô tả A')).toBeNull()
    fireEvent.click(screen.getAllByText('xem mô tả')[0])
    expect(screen.getByText('mô tả A')).toBeTruthy()
    fireEvent.click(screen.getByText('ẩn mô tả'))
    expect(screen.queryByText('mô tả A')).toBeNull()
  })

  it('key "query_database" (KHÔNG có UI-plugin riêng, chủ đích) -> rơi về fallback, không throw', async () => {
    const { ctx } = await bootCtxWithPlugin()
    const owner: ToolViewOwnerProps = {
      toolCall: { name: 'query_database', args: { sessionId: 's1' } },
      result: [{ type: 'seed', value: 1 }],
      state: 'ok',
    }

    render(<RenderSlot ctx={ctx} name="tool.call.toolview" entryKey="query_database" owner={owner} fallback={GenericFallback} />)

    expect(screen.getByTestId('generic-fallback')).toBeTruthy()
  })

  it('gỡ UI-plugin GIỮA LÚC app đang chạy (hot-swap tầng UI) -> tự rơi về fallback, không crash, không cần remount cây React cha', async () => {
    const { ctx, pluginFiber } = await bootCtxWithPlugin()
    const owner: ToolViewOwnerProps = {
      toolCall: { name: 'web_search', args: { query: 'giá vàng' } },
      result: SEARCH_RESULT,
      state: 'ok',
    }

    render(<RenderSlot ctx={ctx} name="tool.call.toolview" entryKey="web_search" owner={owner} fallback={GenericFallback} />)
    expect(screen.queryByTestId('generic-fallback')).toBeNull()

    await act(async () => {
      await pluginFiber.dispose()
      await settle()
    })

    expect(screen.getByTestId('generic-fallback')).toBeTruthy()
  })
})
