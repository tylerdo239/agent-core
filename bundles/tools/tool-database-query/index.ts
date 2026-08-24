// bundles/tool-database-query — Phase 3 ví dụ #1: tool ↔ storage.
//
// Toàn bộ cơ chế spatial composability nằm ở dòng `inject` bên dưới. Khi
// ctx.storage bị unmount, Cordis tự dispose fiber của plugin này (tool tự
// rút khỏi ToolRegistry — xem bundles/tool-registry). Khi storage mount lại,
// Cordis tự chạy lại apply() — không throw, không cần try/catch thủ công
// (coding rule A8).
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/storage.ts'
import '../../../seams/prompt.ts'
import '../../../seams/tools.ts'

export const inject = ['storage', 'tools', 'prompts']

export const apply = (ctx: Context) => {
  ctx.prompts.section({
    name: 'tool:query_database',
    order: 115,
    text: [
      'Session-event guidance:',
      '- `query_database()` reads the stored event log for the CURRENT agent session; it does not query uploaded tabular datasets and cannot read other sessions.',
      '- Use it only when the request requires session trace, audit, or prior event details not already available in semantic memory.',
    ].join('\n'),
  })

  ctx.tools.add({
    name: 'query_database',
    description: 'Đọc lại toàn bộ event đã ghi cho session hiện tại từ storage.',
    // Finding A1 (docs/agent-core-rate-limit-and-security-audit.md): KHÔNG
    // nhận sessionId từ model nữa -- trước đây tool này tin thẳng
    // args.sessionId do model tự cho, đọc được transcript của BẤT KỲ
    // session nào (bypass hoàn toàn canAccessSession() đã build cho REST/
    // WS/gRPC). Luôn dùng context.sessionId (session THẬT của turn đang
    // chạy, do ToolRegistry.invoke() truyền xuống, không phải giá trị tự
    // khai) -- không còn lý do nghiệp vụ nào để 1 turn tự tra session khác.
    parameters: { type: 'object', properties: {} },
    // Phase 8.5: không khai `render` → web-ui mặc định dùng card IN/OUT chung.
    ui: { icon: '🗄️', label: 'Tra dữ liệu' },
    async handler(_args, context) {
      return ctx.storage.readEvents(context.sessionId)
    },
  })

  ctx.logger('tool-database-query').info('activated — storage dependency satisfied')
}
