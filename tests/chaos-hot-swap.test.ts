// Phase 5 deliverable: đổi loop driver giữa lúc có turn khác đang chạy,
// không restart hệ thống, không crash. Đây là bài test tổng hợp xác nhận cả
// 3 yêu cầu ban đầu cùng lúc (temporal + spatial composability + pin theo
// coding rule B4), trên 1 hệ thống "boot đầy đủ" — không phải unit test cô
// lập từng mảnh.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as loopPlannerCritic from '../bundles/loop-drivers/loop-planner-critic/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'

// FakeLlm quyết định hành vi dựa trên NỘI DUNG hội thoại (không phải counter
// ẩn) — cùng kỷ luật test đã dùng ở Phase 3/4, không phụ thuộc mạng thật.
class ChaosFakeLlm extends LlmService {
  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    const last = messages.at(-1)
    if (last?.content.includes('rà soát')) {
      return { content: 'câu trả lời đã rà soát' }
    }
    const userMsg = messages.find((m) => m.role === 'user')?.content ?? ''
    const hasToolResult = messages.some((m) => m.role === 'tool')
    if (userMsg.includes('research') && !hasToolResult) {
      return { content: 'đang tra cứu, cần chạy tác vụ dài...', toolCall: { name: 'slow_research', args: {} } }
    }
    return { content: `trả lời cho: ${userMsg}` }
  }
}
const chaosFakeLlm = (ctx: Context) => {
  ctx.plugin(ChaosFakeLlm)
}

// Tool "chạy lâu" thật (delay thật qua setTimeout) — tạo ra 1 cửa sổ thời
// gian THẬT SỰ mà turn của session-1 còn "đang chạy dở" để swap driver vào
// giữa lúc đó, không phải chỉ đúng về mặt kỹ thuật (pin xảy ra đồng bộ ngay
// từ đầu turn — xem bundles/agent-runner) mà còn quan sát được rõ ràng.
const slowResearchTool = Object.assign(
  (ctx: Context) => {
    ctx.tools.add({
      name: 'slow_research',
      description: 'giả lập tác vụ nghiên cứu chạy lâu',
      async handler() {
        await new Promise((r) => setTimeout(r, 60))
        return { findings: 'đã xong' }
      },
    })
  },
  { inject: ['tools'] },
)

async function settle(ms = 10) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('Phase 5 — chaos hot-swap', () => {
  it('đổi loop driver giữa lúc có turn khác đang chạy, không restart, không crash', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(slowResearchTool)
    root.plugin(chaosFakeLlm)
    root.plugin(loopRegistry)
    const loopDefaultFiber = root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()

    expect(root.loop.has('default')).toBe(true)

    // Turn dài đang chạy (session-1) — sẽ đi vào bước gọi slow_research và
    // đang await 60ms bên trong khi ta swap driver.
    const session1 = new Session('session-1')
    const longRunningTurn = root.agent.runTurn('default', session1, 'research đề tài dài...')

    // Đợi đủ để turn đã pin driver CŨ và đang await bên trong slow_research,
    // nhưng CHƯA xong (tool cần 60ms).
    await settle(20)

    // Hot-swap: gỡ loop-default, mount loop-planner-critic — KHÔNG restart
    // hệ thống, session-1 vẫn đang chạy dở.
    await loopDefaultFiber.dispose()
    expect(root.loop.has('default')).toBe(false) // có 1 khoảnh khắc KHÔNG có driver nào — hệ thống không crash vì điều đó
    root.plugin(loopPlannerCritic)
    await settle()
    expect(root.loop.has('default')).toBe(true) // driver MỚI đã đứng tên 'default'

    // session-1 hoàn tất KHÔNG lỗi, dùng ĐÚNG driver cũ (loop-default — không
    // có bước "rà soát", không có tiền tố [reviewed]).
    const result1 = await longRunningTurn
    expect(result1).toBeDefined()
    expect(result1.content).not.toMatch(/^\[reviewed\]/)
    expect(result1.steps).toBe(1) // 1 vòng tool-call đã hoàn tất trước bước trả lời cuối

    const events1 = await root.storage.readEvents('session-1')
    expect(events1.map((e) => e.type)).toEqual(['user_message', 'model_message', 'tool_audit', 'tool_result', 'model_message'])
    expect(events1.some((e) => e.type === 'critic_message')).toBe(false)

    // session-2 tạo SAU khi swap — dùng driver MỚI (loop-planner-critic).
    const session2 = new Session('session-2')
    const result2 = await root.agent.runTurn('default', session2, 'câu hỏi khác')
    expect(result2.content).toBe('[reviewed] câu trả lời đã rà soát')

    const events2 = await root.storage.readEvents('session-2')
    expect(events2.map((e) => e.type)).toEqual(['user_message', 'model_message', 'critic_message'])
  })

  it('lặp lại swap nhiều lần liên tiếp không leak — mỗi lần gỡ đúng đăng ký cũ trước khi thêm cái mới', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(chaosFakeLlm)
    root.plugin(loopRegistry)
    root.plugin(agentRunner)
    await settle()

    let currentFiber = root.plugin(loopDefault)
    let usingDefault = true
    await settle()

    for (let i = 0; i < 5; i++) {
      const session = new Session(`s-${i}`)
      const result = await root.agent.runTurn('default', session, `câu hỏi ${i}`)
      expect(result.content).toBe(
        usingDefault ? `trả lời cho: câu hỏi ${i}` : '[reviewed] câu trả lời đã rà soát',
      )

      await currentFiber.dispose()
      expect(root.loop.has('default')).toBe(false)
      usingDefault = !usingDefault
      currentFiber = usingDefault ? root.plugin(loopDefault) : root.plugin(loopPlannerCritic)
      await settle()
      expect(root.loop.has('default')).toBe(true)
    }

    await currentFiber.dispose()
    expect(root.loop.has('default')).toBe(false)

    // Sau toàn bộ vòng swap, service llm/storage/tools KHÔNG hề bị đụng tới —
    // vẫn sống nguyên, chứng minh hot-swap chỉ ảnh hưởng đúng phạm vi loop
    // driver, không lan sang phần khác của hệ thống.
    expect(root.reflect.get('llm', false)).toBeDefined()
    expect(root.reflect.get('storage', false)).toBeDefined()
    expect(root.reflect.get('tools', false)).toBeDefined()
  })
})
