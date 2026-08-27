// Chuyển khả năng llm-router chọn skill từ loop-rlm sang loop-default
// (2026-08): trước đây `skillSelection` (seams/skill-selection.ts,
// bundles/providers/skill-selection-llm) chỉ được gọi trong loop-rlm
// (bundles/loop-drivers/loop-rlm/index.ts) khi không có skill explicit/
// trigger nào khớp. Test này xác nhận loop-default giờ có đúng fallback
// tương tự: 1 lượt LLM router rẻ tiền trước khi vào turn chính, chỉ khi
// không có skill nào được chọn qua đường deterministic (selectedSkill/
// trigger), và chỉ khi provider `skillSelection` thật sự được mount
// (optional — không mount thì loop-default chạy y hệt trước đây).
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as skillSelectionLlm from '../bundles/providers/skill-selection-llm/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

function registerZeroTriggerSkill(ctx: Context) {
  ctx.skills.register({
    name: 'cohort-analysis',
    description: 'Analyze retention by signup cohort and compare behavior over time.',
    // Không có trigger nào -- chỉ tìm được qua router LLM hoặc tool `skill`.
    instructions: 'Build a retention matrix before drawing conclusions.',
    triggers: [],
    userInvocable: true,
  })
}

describe('llm-router chọn skill: transfer từ loop-rlm sang loop-default', () => {
  it('không match trigger nào -> gọi skillSelection router trước turn chính, tải đúng skill', async () => {
    const routerCalls: LlmMessage[][] = []
    class RouterThenTurnLlm extends LlmService {
      async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
        const isRouterCall = options.tools?.[0]?.name === 'skill' && Array.isArray((options.tools[0].parameters as any)?.properties?.name?.enum)
        if (isRouterCall) {
          routerCalls.push(messages)
          return { content: '', model: 'router-model', toolCall: { name: 'skill', args: { name: 'cohort-analysis' } }, usage: { totalTokens: 9 } }
        }
        // Turn chính: đến đây nghĩa là skill đã được nạp qua router (kiểm
        // tra instructions có mặt trong prompt).
        expect(messages[0]?.content).toContain('Build a retention matrix')
        return { content: 'Đã dùng cohort-analysis.' }
      }
    }
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(skillSelectionLlm)
    root.plugin(promptRegistry)
    root.plugin(promptDefaultAgent)
    root.plugin(contextCompactorLlm)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(RouterThenTurnLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()
    registerZeroTriggerSkill(root)

    const session = new Session('router-default-loop')
    const result = await root.agent.runTurn('default', session, {
      message: 'So sánh users theo tháng đăng ký và mức quay lại.',
    })

    expect(result.content).toBe('Đã dùng cohort-analysis.')
    expect(routerCalls).toHaveLength(1)

    const events = await root.storage.readEvents(session.id)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'skill_selection', source: 'default-loop', strategy: 'semantic', outcome: 'selected', skill: 'cohort-analysis',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'skill_loaded', source: 'default-loop', activation: 'semantic', skill: 'cohort-analysis',
    }))
    await root.fiber.dispose()
  })

  it('không mount skillSelection -> loop-default chạy y hệt trước đây, không throw, không tải skill nào', async () => {
    class PlainLlm extends LlmService {
      async complete(): Promise<LlmCompletion> {
        return { content: 'ok, không skill nào cả.' }
      }
    }
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    // Cố ý KHÔNG mount skillSelectionLlm.
    root.plugin(promptRegistry)
    root.plugin(promptDefaultAgent)
    root.plugin(contextCompactorLlm)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(PlainLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()
    registerZeroTriggerSkill(root)

    const session = new Session('no-router-default-loop')
    const result = await root.agent.runTurn('default', session, { message: 'Câu hỏi bất kỳ không liên quan skill nào.' })

    expect(result.content).toBe('ok, không skill nào cả.')
    const events = await root.storage.readEvents(session.id)
    expect(events.some((e: any) => e.type === 'skill_selection')).toBe(false)
    expect(events.some((e: any) => e.type === 'skill_loaded')).toBe(false)
    await root.fiber.dispose()
  })

  it('skill riêng của user (custom skill, ownerId khớp session) -> nằm trong catalog gửi cho router, router chọn được', async () => {
    const routerCatalogs: unknown[] = []
    class RouterSeesCustomSkillLlm extends LlmService {
      async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
        const isRouterCall = options.tools?.[0]?.name === 'skill' && Array.isArray((options.tools[0].parameters as any)?.properties?.name?.enum)
        if (isRouterCall) {
          routerCatalogs.push((options.tools![0].parameters as any).properties.name.enum)
          return { content: '', toolCall: { name: 'skill', args: { name: 'my-custom-workflow' } } }
        }
        expect(messages[0]?.content).toContain('follow my private checklist')
        return { content: 'Đã dùng skill riêng của user.' }
      }
    }
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(skillSelectionLlm)
    root.plugin(promptRegistry)
    root.plugin(promptDefaultAgent)
    root.plugin(contextCompactorLlm)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(RouterSeesCustomSkillLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()

    // Mô phỏng custom skill user tự thêm (bundles/providers/custom-skill-store-postgres
    // dùng chính API `upsert()` này để warm ctx.skills lúc boot / sau CRUD).
    root.skills.upsert({
      name: 'my-custom-workflow',
      description: 'A private workflow only this user owns.',
      instructions: 'follow my private checklist',
      triggers: [],
      userInvocable: true,
      ownerId: 'user-abc',
    })

    const session = new Session('custom-skill-default-loop', 8, undefined, 'default', 40, 'user-abc')
    const result = await root.agent.runTurn('default', session, { message: 'Chạy đúng quy trình riêng của tôi giúp tôi.' })

    expect(result.content).toBe('Đã dùng skill riêng của user.')
    expect(routerCatalogs).toHaveLength(1)
    expect(routerCatalogs[0]).toContain('my-custom-workflow')

    const events = await root.storage.readEvents(session.id)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'skill_loaded', source: 'default-loop', activation: 'semantic', skill: 'my-custom-workflow',
    }))
    await root.fiber.dispose()
  })

  it('skill riêng của user KHÁC (ownerId không khớp session) -> KHÔNG nằm trong catalog, router không thấy được', async () => {
    const routerCatalogs: unknown[] = []
    class RouterLlm extends LlmService {
      async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
        const isRouterCall = options.tools?.[0]?.name === 'skill' && Array.isArray((options.tools[0].parameters as any)?.properties?.name?.enum)
        if (isRouterCall) {
          routerCatalogs.push((options.tools![0].parameters as any).properties.name.enum)
          return { content: '', toolCall: { name: 'skill', args: { name: 'someone-elses-skill' } } }
        }
        return { content: 'không dùng skill nào.' }
      }
    }
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(skillSelectionLlm)
    root.plugin(promptRegistry)
    root.plugin(promptDefaultAgent)
    root.plugin(contextCompactorLlm)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(RouterLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()

    root.skills.upsert({
      name: 'someone-elses-skill',
      description: 'A private workflow owned by a different user.',
      instructions: 'not yours',
      triggers: [],
      userInvocable: true,
      ownerId: 'user-other',
    })

    const session = new Session('other-owner-skill-default-loop', 8, undefined, 'default', 40, 'user-abc')
    const result = await root.agent.runTurn('default', session, { message: 'Chạy đúng quy trình riêng của tôi giúp tôi.' })

    expect(result.content).toBe('không dùng skill nào.')
    // Catalog rỗng (skill của user khác bị lọc mất) -> skillSelectionLlm early-return
    // KHÔNG gọi LLM router (xem `if (!candidates.length) return {}`), chứ không phải
    // gọi rồi bị lọc ra sau.
    expect(routerCatalogs).toHaveLength(0)

    const events = await root.storage.readEvents(session.id)
    expect(events.some((e: any) => e.type === 'skill_loaded')).toBe(false)
    await root.fiber.dispose()
  })
})
