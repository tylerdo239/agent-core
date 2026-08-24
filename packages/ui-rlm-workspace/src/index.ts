// packages/ui-rlm-workspace/src/index.ts — UI-plugin đăng ký 2 component RLM
// vào 2 slot mới, dưới key 'rlm' (kind 'keyed', khai ở
// apps/web/src/client-context.ts — xem docs/agent-core-rlm-web-ui-plugin-plan.md
// mục 1). Session driver 'default'/'planner-critic' không có registrant nào
// khớp key -> RenderSlot tự rơi về fallback (App.tsx truyền `() => null`),
// workspace bar/skill-select KHÔNG hiện cho chat thường — đây chính là điểm
// mấu chốt của plan: hiện/ẩn nằm ở registry, không phải if/else cứng trong
// App.tsx.
import { Context } from '@deepseek-ai/cordis'
import '@agent-core/ui-slots'
import { WorkspaceHeaderPanel } from './WorkspaceHeaderPanel.tsx'
import { SkillComposerExtra } from './SkillComposerExtra.tsx'

export { WorkspaceHeaderPanel, type WorkspaceEntry, type WorkspaceHeaderPanelProps, type WorkspaceUploadState } from './WorkspaceHeaderPanel.tsx'
export { SkillComposerExtra, type SkillComposerExtraProps, type SkillOption } from './SkillComposerExtra.tsx'

export const inject = ['slots']

export const apply = (ctx: Context) => {
  // Coding rule A15 (giống ui-tool-web-search): disposer từ ctx.slots.register()
  // PHẢI bọc qua ctx.effect() — fiber này unmount thì entry tự rút, session
  // rlm tự rơi về fallback (không hiện gì), không crash trang.
  ctx.effect(() => {
    return ctx.slots.register('session.chrome.header', {
      key: 'rlm',
      component: WorkspaceHeaderPanel,
      registrant: 'ui-rlm-workspace',
    })
  })
  ctx.effect(() => {
    return ctx.slots.register('session.chrome.composer', {
      key: 'rlm',
      component: SkillComposerExtra,
      registrant: 'ui-rlm-workspace',
    })
  })
}
