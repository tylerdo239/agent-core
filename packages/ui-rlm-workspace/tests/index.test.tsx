// @vitest-environment jsdom
//
// docs/agent-core-rlm-web-ui-plugin-plan.md mục 6, case 1-3: UI-plugin thật
// mount -> dispatch đúng key 'rlm'; session driver khác ('default') không
// khớp key -> rơi về fallback; unmount fiber giữa chừng (mô phỏng hot-swap)
// -> rơi về fallback, không crash trang. Cùng pattern
// packages/ui-tool-web-search/tests/index.test.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import * as uiSlots from '@agent-core/ui-slots'
import * as uiRlmWorkspace from '../src/index.ts'
import { RenderSlot } from '@agent-core/ui-react'
import { WorkspaceHeaderPanel, type WorkspaceHeaderPanelProps } from '../src/WorkspaceHeaderPanel.tsx'
import type { SkillComposerExtraProps } from '../src/SkillComposerExtra.tsx'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

function HeaderFallback() {
  return <div data-testid="header-fallback" />
}

function ComposerFallback() {
  return <div data-testid="composer-fallback" />
}

async function bootCtxWithPlugin() {
  const ctx = new Context()
  const slotsFiber = ctx.plugin(uiSlots)
  await settle()
  await slotsFiber.await()
  ctx.slots.declare('session.chrome.header', 'keyed')
  ctx.slots.declare('session.chrome.composer', 'keyed')
  const pluginFiber = ctx.plugin(uiRlmWorkspace)
  await settle()
  await pluginFiber.await()
  return { ctx, pluginFiber }
}

const headerOwner: WorkspaceHeaderPanelProps = {
  uploadDisabled: false,
  refreshDisabled: false,
  onUpload: () => {},
  onRefresh: () => {},
  onDownload: () => {},
  onPreview: () => {},
  datasetsCount: 0,
  artifactsCount: 0,
  loading: false,
  error: '',
  uploadState: null,
  entries: [],
}

const composerOwner: SkillComposerExtraProps = {
  skills: [],
  selectedSkill: '',
  disabled: false,
  onSelectSkill: () => {},
}

afterEach(cleanup)

describe('ui-rlm-workspace — dispatch theo entryKey = session.driver', () => {
  it('chuyển toàn bộ file được chọn và preview output thay vì tải trực tiếp', () => {
    const onUpload = vi.fn()
    const onDownload = vi.fn()
    const onPreview = vi.fn()
    const { container } = render(<WorkspaceHeaderPanel {...headerOwner}
      onUpload={onUpload}
      onDownload={onDownload}
      onPreview={onPreview}
      entries={[
        { path: 'sales.csv', size: 12, mtime: '', kind: 'dataset' },
        { path: 'generated/chart.png', size: 24, mtime: '', kind: 'output' },
      ]}
    />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const files = [new File(['a'], 'a.csv'), new File(['b'], 'b.csv')]
    fireEvent.change(input, { target: { files } })
    expect(onUpload).toHaveBeenCalledWith(files)

    fireEvent.click(screen.getByText('sales.csv'))
    expect(onDownload).toHaveBeenCalledWith('sales.csv')
    fireEvent.click(screen.getByText('generated/chart.png'))
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ path: 'generated/chart.png' }))
  })

  it('entryKey "rlm" -> render WorkspaceHeaderPanel/SkillComposerExtra thật, không phải fallback', async () => {
    const { ctx } = await bootCtxWithPlugin()

    render(<RenderSlot ctx={ctx} name="session.chrome.header" entryKey="rlm" owner={headerOwner} fallback={HeaderFallback} />)
    expect(screen.queryByTestId('header-fallback')).toBeNull()
    expect(document.getElementById('workspace-bar')).not.toBeNull()
    cleanup()

    render(<RenderSlot ctx={ctx} name="session.chrome.composer" entryKey="rlm" owner={composerOwner} fallback={ComposerFallback} />)
    expect(screen.queryByTestId('composer-fallback')).toBeNull()
    expect(screen.queryByLabelText('Chọn skill')).not.toBeNull()
  })

  it('entryKey "default" (session chat thường) -> KHÔNG khớp key nào -> rơi về fallback, không hiện workspace bar', async () => {
    const { ctx } = await bootCtxWithPlugin()

    render(<RenderSlot ctx={ctx} name="session.chrome.header" entryKey="default" owner={headerOwner} fallback={HeaderFallback} />)
    expect(screen.queryByTestId('header-fallback')).not.toBeNull()
    expect(document.getElementById('workspace-bar')).toBeNull()
    cleanup()

    render(<RenderSlot ctx={ctx} name="session.chrome.composer" entryKey="default" owner={composerOwner} fallback={ComposerFallback} />)
    expect(screen.queryByTestId('composer-fallback')).not.toBeNull()
    expect(screen.queryByLabelText('Chọn skill')).toBeNull()
  })

  it('unmount fiber UI-plugin giữa lúc app đang chạy -> rơi về fallback, không throw', async () => {
    const { ctx, pluginFiber } = await bootCtxWithPlugin()
    await pluginFiber.dispose()

    render(<RenderSlot ctx={ctx} name="session.chrome.header" entryKey="rlm" owner={headerOwner} fallback={HeaderFallback} />)
    expect(screen.queryByTestId('header-fallback')).not.toBeNull()
  })
})
