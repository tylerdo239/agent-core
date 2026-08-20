// bundles/subagent-report-writer — Phase 3 ví dụ #2: subagent ↔ permission + llm.
//
// 2 dependency cùng lúc trong `inject`: subagent chỉ activate khi CẢ HAI đều
// sẵn sàng; mất 1 trong 2 là tự suspend, không throw giữa chừng.
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/permission.ts'
import '../../../seams/llm.ts'
import '../../../seams/subagents.ts'

export const inject = ['permission', 'llm', 'subagents']

export const apply = (ctx: Context) => {
  ctx.subagents.register({
    name: 'report-writer',
    async run(task: string) {
      const allowed = await ctx.permission.check('report-writer', 'generate')
      if (!allowed) throw new Error('permission denied')
      const result = await ctx.llm.complete([{ role: 'user', content: task }])
      return result.content
    },
  })

  ctx.logger('subagent-report-writer').info('subagent activated')
}
