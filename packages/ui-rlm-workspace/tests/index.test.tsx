// @vitest-environment jsdom
//
// docs/agent-core-rlm-web-ui-plugin-plan.md mục 6, case 1-3: UI-plugin thật
// mount -> dispatch đúng key 'rlm'; session driver khác ('default') không
// khớp key -> rơi về fallback; unmount fiber giữa chừng (mô phỏng hot-swap)
// -> rơi về fallback, không crash trang. Cùng pattern
// packages/ui-tool-web-search/tests/index.test.tsx.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import * as uiSlots from '@agent-core/ui-slots'
import * as uiRlmWorkspace from '../src/index.ts'
import { RenderSlot } from '@agent-core/ui-react'
import type { WorkspaceHeaderPanelProps } from '../src/WorkspaceHeaderPanel.tsx'
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
