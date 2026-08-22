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
      '- `query_database(sessionId=...)` reads the stored event log for that agent session; it does not query uploaded tabular datasets.',
      '- Use it only when the request requires session trace, audit, or prior event details not already available in semantic memory.',
    ].join('\n'),
  })

  ctx.tools.add({
    name: 'query_database',
    description: 'Đọc lại toàn bộ event đã ghi cho 1 session từ storage.',
    parameters: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
    // Phase 8.5: không khai `render` → web-ui mặc định dùng card IN/OUT chung.
    ui: { icon: '🗄️', label: 'Tra dữ liệu' },
    async handler(args) {
      const sessionId = String(args.sessionId ?? '')
      return ctx.storage.readEvents(sessionId)
    },
  })

  ctx.logger('tool-database-query').info('activated — storage dependency satisfied')
}
