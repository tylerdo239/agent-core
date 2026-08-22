// Phase 3 deliverable: ≥3 cặp dependency thật trong hệ thống, mỗi cặp có
// test "tháo lắp không lỗi giữa chừng, tự resume" pass thật — không phải chỉ
// đọc docs rồi tin nó hoạt động (đã verify cơ chế này bằng script độc lập
// trước khi viết bundle nào, xem ghi chú trong README.md).
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolDatabaseQuery from '../bundles/tools/tool-database-query/index.ts'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as subagentManager from '../bundles/providers/subagent-manager/index.ts'
import * as subagentReportWriter from '../bundles/subagents/subagent-report-writer/index.ts'
import * as toolWebSearch from '../bundles/tools/tool-web-search/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import { LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'

// Fake LLM: seam thật, provider giả — test spatial composability không được
// phép phụ thuộc mạng thật (kỷ luật test, không phải giới hạn của Cordis).
class FakeLlm extends LlmService {
  async complete(messages: LlmMessage[]): Promise<LlmCompletion> {
    return { content: `echo: ${messages.at(-1)?.content ?? ''}` }
  }
}
const fakeLlm = (ctx: Context) => {
  ctx.plugin(FakeLlm)
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('spatial composability — tool ↔ storage', () => {
  it('tool tự suspend khi storage bị gỡ, tự resume khi storage quay lại', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(promptRegistry)
    const storageFork = root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(toolDatabaseQuery)
    await settle()

    expect(root.tools.has('query_database')).toBe(true)
    expect(root.prompts.hasSection('tool:query_database')).toBe(true)

    await storageFork.dispose()
    await settle()
    expect(root.tools.has('query_database')).toBe(false) // suspend, KHÔNG throw
    expect(root.prompts.hasSection('tool:query_database')).toBe(false)

    root.plugin(stateSqlite, { path: ':memory:' })
    await settle()
    expect(root.tools.has('query_database')).toBe(true) // resume
    expect(root.prompts.hasSection('tool:query_database')).toBe(true)
  })
})

describe('spatial composability — subagent ↔ permission + llm', () => {
  it('subagent tự suspend khi permission HOẶC llm bị gỡ, tự resume khi cả hai quay lại', async () => {
    const root = new Context()
    root.plugin(subagentManager)
    const permissionFork = root.plugin(permissionRbac, {
      rules: { 'report-writer': ['generate'] },
    })
    const llmFork = root.plugin(fakeLlm)
    root.plugin(subagentReportWriter)
    await settle()

    expect(root.subagents.has('report-writer')).toBe(true)

    await permissionFork.dispose()
    await settle()
    expect(root.subagents.has('report-writer')).toBe(false)

    root.plugin(permissionRbac, { rules: { 'report-writer': ['generate'] } })
    await settle()
    expect(root.subagents.has('report-writer')).toBe(true)

    await llmFork.dispose()
    await settle()
    expect(root.subagents.has('report-writer')).toBe(false)

    root.plugin(fakeLlm)
    await settle()
    expect(root.subagents.has('report-writer')).toBe(true)

    const result = await root.subagents.get('report-writer')!.run('viết báo cáo')
    expect(result).toBe('echo: viết báo cáo')
  })
})

describe('spatial composability — tool ↔ permission', () => {
  it('tool tự suspend khi permission bị gỡ, tự resume khi permission quay lại', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(promptRegistry)
    const permissionFork = root.plugin(permissionRbac, {
      rules: { 'web-search': ['search'] },
    })
    root.plugin(toolWebSearch)
    await settle()

    expect(root.tools.has('web_search')).toBe(true)
    expect(root.prompts.hasSection('tool:web_search')).toBe(true)

    await permissionFork.dispose()
    await settle()
    expect(root.tools.has('web_search')).toBe(false)
    expect(root.prompts.hasSection('tool:web_search')).toBe(false)

    root.plugin(permissionRbac, { rules: { 'web-search': ['search'] } })
    await settle()
    expect(root.tools.has('web_search')).toBe(true)
    expect(root.prompts.hasSection('tool:web_search')).toBe(true)
  })
})
