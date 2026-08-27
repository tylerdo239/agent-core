// Tái hiện đúng chuỗi sự kiện thật từ production (2026-08, session
// 9e47c762-3b2b-409f-8ced-fd3c32c82034): model gọi skill `business-case-builder`
// đúng cách, đọc resource đầu tiên đúng cách, rồi ở lượt 3 (đọc resource thứ
// 2) bắt chước nhãn `[tool_call:read_skill_resource(...)]` như plain text
// thay vì gọi tool thật -- xem src/leaked-tool-call-label.ts. Test này xác
// nhận loop-default khôi phục đúng ý định, tool thật sự chạy, không kết
// thúc turn với nội dung rác leak ra UI.
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as toolSkill from '../bundles/tools/tool-skill/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

function registerSkill(ctx: Context) {
  ctx.skills.register({
    name: 'business-case-builder',
    description: 'Build a full business case.',
    instructions: 'Follow the KPI framework.',
    triggers: ['business case'],
    userInvocable: true,
    resources: [
      { path: 'references/business-analysis-guide.md', kind: 'reference' },
      { path: 'references/scientific-analysis-guide.md', kind: 'reference' },
    ],
  }, async (path) => ({
    path, kind: 'reference', encoding: 'utf8',
    content: path.includes('scientific') ? 'Quantify with confidence intervals.' : 'Market sizing via TAM/SAM/SOM.',
  }))
}

describe('leaked [tool_call:...] label repair — kịch bản đúng production', () => {
  it('model leak nhãn tool_call ở lượt 3 -> tool đọc resource thứ 2 vẫn CHẠY THẬT, không kết thúc turn với rác', async () => {
    let turn = 0
    class ReplayLlm extends LlmService {
      async complete(_messages: LlmMessage[], _options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
        turn += 1
        if (turn === 1) return { content: '', toolCall: { name: 'skill', args: { name: 'business-case-builder' } } }
        if (turn === 2) return { content: '', toolCall: { name: 'read_skill_resource', args: { name: 'business-case-builder', path: 'references/business-analysis-guide.md' } } }
        if (turn === 3) {
          // Đúng y hệt raw content leak thật thấy trong production DB.
          return { content: '[tool_call:read_skill_resource({"name":"business-case-builder","path":"references/scientific-analysis-guide.md"})]' }
        }
        return { content: 'Đã đọc đủ 2 tài liệu, đây là báo cáo cuối.' }
      }
    }
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(promptDefaultAgent)
    root.plugin(contextCompactorLlm)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(ReplayLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    root.plugin(toolSkill)
    await settle()
    registerSkill(root)

    const session = new Session('leaked-label-repair')
    const result = await root.agent.runTurn('default', session, { message: 'phân tích tình hình doanh nghiệp trong ngành viễn thông' })

    expect(result.content).toBe('Đã đọc đủ 2 tài liệu, đây là báo cáo cuối.')
    expect(result.steps).toBe(3)

    const events = await root.storage.readEvents(session.id)
    // KHÔNG có model_message nào lộ ra content dạng "[tool_call:...]" leak.
    for (const e of events as any[]) {
      if (e.type === 'model_message') expect(e.content).not.toContain('[tool_call:')
    }
    // Tool đọc resource thứ 2 THẬT SỰ đã chạy (không chỉ là text bị bỏ qua).
    expect(events).toContainEqual(expect.objectContaining({
      type: 'skill_resource', skill: 'business-case-builder', path: 'references/scientific-analysis-guide.md',
    }))
    const secondReadResult = (events as any[]).find(
      (e) => e.type === 'tool_result' && e.name === 'read_skill_resource' && e.result?.path === 'references/scientific-analysis-guide.md',
    )
    expect(secondReadResult?.result?.content).toBe('Quantify with confidence intervals.')
    await root.fiber.dispose()
  })
})
