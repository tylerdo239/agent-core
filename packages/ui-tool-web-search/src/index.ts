// packages/ui-tool-web-search/src/index.ts — Phase 9.5: đăng ký WebSearchCard
// vào slot 'tool.call.toolview' dưới key 'web_search' — PHẢI khớp tuyệt đối
// `ToolDefinition.name` của tool-web-search phía server
// (bundles/tools/tool-web-search/index.ts) — xem docs/ui-plugin-build-guide.md
// mục 2 (đây là chỗ dễ sai nhất, compiler không báo lỗi gì nếu lệch).
import { Context } from '@deepseek-ai/cordis'
import '@agent-core/ui-slots'
import { WebSearchCard } from './WebSearchCard.tsx'

export const inject = ['slots']

export const apply = (ctx: Context) => {
  // Coding rule A15: disposer từ ctx.slots.register() PHẢI bọc qua
  // ctx.effect() — fiber này unmount thì entry tự rút, UI tự rơi về
  // GenericToolCard (không cần dọn tay, không crash trang). Block body
  // (không expression body) — nhất quán với ví dụ chuẩn của coding rule A2/
  // A11, dù ở đây không có ctx.plugin() nào bị trả ngầm (register() trả
  // thẳng 1 disposer đồng bộ, không phải Fiber) nên không rơi đúng vào rủi
  // ro A11 mô tả — vẫn giữ block body để không cần giải trình riêng mỗi lần
  // review theo checklist "grep `=> ctx.`".
  ctx.effect(() => {
    return ctx.slots.register('tool.call.toolview', {
      key: 'web_search',
      component: WebSearchCard,
      registrant: 'ui-tool-web-search',
    })
  })
}
