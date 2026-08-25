// Phase 6.0 deliverable: seams/sessions.ts + provider, và seams/loop.ts phát
// `agent/step` đúng 3 điểm (model_message, tool_result, final) — KHÔNG cần
// adapter nào (REST/WS/gRPC) đã build để verify việc này.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { LoopStep } from '../seams/loop.ts'

class FakeLlm extends LlmService {
  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    const hasToolResult = messages.some((m) => m.role === 'tool')
    if (!hasToolResult) {
      return { content: 'gọi tool xem sao', toolCall: { name: 'echo', args: { text: 'hi' } } }
    }
    return { content: 'xong rồi' }
  }
}
const fakeLlm = (ctx: Context) => {
  ctx.plugin(FakeLlm)
}
const echoTool = Object.assign(
  (ctx: Context) => {
    ctx.tools.add({ name: 'echo', description: 'echo lại', async handler(args) { return args } })
  },
  { inject: ['tools'] },
)

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('Phase 6.0 — ctx.sessions', () => {
  it('create() sinh id nếu không chỉ định, get()/list() tra đúng, tạo trùng id thì throw', async () => {
    const root = new Context()
    root.plugin(sessionRegistry)
    await settle()

    const s1 = root.sessions.create({ systemPrompt: 'bạn là trợ lý' })
    expect(s1.id).toBeTruthy()
    expect(s1.driver).toBe('default')
    expect(s1.history).toEqual([{ role: 'system', content: 'bạn là trợ lý' }])

    const s2 = root.sessions.create({ id: 'fixed-id', driver: 'planner-critic', maxSteps: 3 })
    expect(s2.id).toBe('fixed-id')
    expect(s2.driver).toBe('planner-critic')
    expect(s2.maxSteps).toBe(3)

    expect(root.sessions.get('fixed-id')).toBe(s2)
    expect(root.sessions.list().length).toBe(2)

    expect(() => root.sessions.create({ id: 'fixed-id' })).toThrow(/already exists/)
  })
})

describe('Phase 6.0 — agent/step event', () => {
  it('phát đúng thứ tự model_message -> tool_result -> model_message -> final, khớp với storage', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(echoTool)
    root.plugin(fakeLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    root.plugin(sessionRegistry)
    await settle()

    const steps: LoopStep[] = []
    root.on('agent/step', (event) => {
      expect(event.sessionId).toBe('s1')
      steps.push(event.step)
    })

    const session = root.sessions.create({ id: 's1' })
    const result = await root.agent.runTurn(session.driver, session, 'chào')

    expect(steps.map((s) => s.type)).toEqual(['model_message', 'tool_result', 'model_message', 'final'])
    expect(result.content).toBe('xong rồi')

    const events = await root.storage.readEvents('s1')
    // agent/step không phải nguồn sự thật thứ 2 — số lượng model_message +
    // tool_result phải khớp CHÍNH XÁC với storage (event 'final' không ghi
    // storage riêng, nó trùng với model_message cuối cùng). 'user_message'
    // ghi ở agent-runner (trước cả 'agent/step' đầu tiên) nên không có step
    // 'agent/step' tương ứng — client đã biết sẵn tin nhắn mình gửi.
    expect(events.map((e) => e.type)).toEqual(['user_message', 'model_message', 'tool_audit', 'tool_result', 'model_message'])
  })
})
