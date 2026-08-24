// Phase 4 deliverable: 1 turn end-to-end chạy được: model → quyết định gọi
// tool → ghi event vào storage → trả kết quả. Dùng FakeLlm (seam thật,
// provider giả) để không phụ thuộc mạng thật trong test tự động — cùng kỷ
// luật đã áp dụng cho test Phase 3.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolDatabaseQuery from '../bundles/tools/tool-database-query/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as skillSupportTone from '../bundles/skills/skill-support-tone/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { LoopStep, Session } from '../seams/loop.ts'

class FakeLlm extends LlmService {
  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    // Quảng bá tool phải tới được đây — nếu rỗng thì loop-default có bug.
    if (!options.tools?.some((t) => t.name === 'query_database')) {
      throw new Error('FakeLlm: expected query_database tool to be advertised')
    }
    const hasToolResult = messages.some((m) => m.role === 'tool')
    if (!hasToolResult) {
      return {
        content: 'Để trả lời, tôi cần tra dữ liệu đã lưu.',
        toolCall: { name: 'query_database', args: { sessionId: 'store-A' } },
      }
    }
    return { content: 'Dựa trên dữ liệu đã tra, câu trả lời là: 42.' }
  }
}
const fakeLlm = (ctx: Context) => {
  ctx.plugin(FakeLlm)
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('Phase 4 — agent loop end-to-end', () => {
  it('model → tool_call → storage → kết quả cuối, event ghi đúng thứ tự', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(toolDatabaseQuery)
    root.plugin(fakeLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()

    // 'store-A' là 1 "kho dữ liệu" độc lập với session hội thoại 'demo' —
    // query_database có thể tra bất kỳ sessionId nào được truyền vào, không
    // nhất thiết là session đang hội thoại.
    await root.storage.appendEvent('store-A', { type: 'seed', value: 42 })

    const session = new Session('demo', 8, 'Bạn là trợ lý hữu ích.')
    const result = await root.agent.runTurn('default', session, 'Giá trị đã lưu là bao nhiêu?')

    expect(result.steps).toBe(1)
    expect(result.content).toBe('Dựa trên dữ liệu đã tra, câu trả lời là: 42.')

    const events = await root.storage.readEvents('demo')
    expect(events.map((e) => e.type)).toEqual([
      'user_message', // ghi TRƯỚC khi driver chạy, ở agent-runner (entrypoint ổn định chung mọi driver)
      'model_message', // lượt 1: model quyết định gọi tool
      'tool_audit', // execution pipeline ghi outcome/latency trước khi loop ghi kết quả
      'tool_result', // kết quả tool được ghi TRƯỚC khi qua bước kế tiếp (rule B3)
      'model_message', // lượt 2: model trả lời cuối cùng
    ])

    expect((events[0] as any).content).toBe('Giá trị đã lưu là bao nhiêu?')

    const firstModelMsg = events[1] as any
    expect(firstModelMsg.toolCall).toEqual({ name: 'query_database', args: { sessionId: 'store-A' } })

    const toolResult = events[3] as any
    expect(toolResult.name).toBe('query_database')
    expect(toolResult.result).toEqual([{ type: 'seed', value: 42 }])

    // Session history phản ánh đúng toàn bộ lượt hội thoại.
    expect(session.history.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant', // ghi kèm tool_call
      'tool',
      'assistant', // câu trả lời cuối
    ])
  })

  it('tool không tồn tại → ghi lỗi vào storage, KHÔNG throw, loop tiếp tục', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    // Cố ý KHÔNG mount toolDatabaseQuery — model vẫn "quyết định" gọi nó.
    class BadCallLlm extends LlmService {
      async complete(messages: LlmMessage[]): Promise<LlmCompletion> {
        const hasToolResult = messages.some((m) => m.role === 'tool')
        if (!hasToolResult) {
          return { content: 'gọi tool không tồn tại', toolCall: { name: 'ghost_tool', args: {} } }
        }
        return { content: 'đã xử lý xong dù tool không tồn tại' }
      }
    }
    // LƯU Ý (coding rule A11): body PHẢI có { } — arrow function expression-
    // body (`ctx => ctx.plugin(X)`) trả ngầm về Fiber handle, bị Cordis hiểu
    // nhầm là 1 Effect cần await rồi collect → throw "Invalid effect".
    root.plugin((ctx: Context) => {
      ctx.plugin(BadCallLlm)
    })
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()

    const session = new Session('s2')
    const result = await root.agent.runTurn('default', session, 'test')

    expect(result.content).toBe('đã xử lý xong dù tool không tồn tại')
    const events = await root.storage.readEvents('s2')
    const toolResult = events.find((e) => e.type === 'tool_result') as any
    expect(toolResult.result).toEqual({ error: 'tool "ghost_tool" not found' })
  })

  it('Phase 8.5: agent/step forward đúng toolUi mà tool-database-query đã khai, undefined khi tool không có ui', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(toolDatabaseQuery)
    root.plugin(fakeLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()

    const steps: LoopStep[] = []
    root.on('agent/step', (event) => steps.push(event.step))

    await root.storage.appendEvent('store-B', { type: 'seed', value: 1 })
    const session = new Session('demo-ui')
    await root.agent.runTurn('default', session, 'test')

    const modelMsgWithToolCall = steps.find((s) => s.type === 'model_message' && s.toolCall) as any
    expect(modelMsgWithToolCall.toolUi).toEqual({ icon: '🗄️', label: 'Tra dữ liệu' })

    const toolResultStep = steps.find((s) => s.type === 'tool_result') as any
    expect(toolResultStep.toolUi).toEqual({ icon: '🗄️', label: 'Tra dữ liệu' })

    // model_message KHÔNG kèm toolCall (lượt trả lời cuối) -> không tra ui.
    const finalModelMsg = steps.find((s) => s.type === 'model_message' && !s.toolCall) as any
    expect(finalModelMsg.toolUi).toBeUndefined()
  })

  it('Phase 15: skill khớp trigger -> instructions chèn vào system prompt gửi LLM; không khớp -> không chèn gì', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(skillSupportTone)
    root.plugin(stateSqlite, { path: ':memory:' })

    // Capture đúng mảng messages thật sự gửi cho LLM ở từng lượt gọi.
    const capturedMessages: LlmMessage[][] = []
    class CapturingLlm extends LlmService {
      async complete(messages: LlmMessage[]): Promise<LlmCompletion> {
        capturedMessages.push(messages)
        return { content: 'đã ghi nhận' }
      }
    }
    root.plugin((ctx: Context) => {
      ctx.plugin(CapturingLlm)
    })
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()

    const session = new Session('skill-demo', 8, 'Bạn là trợ lý hữu ích.')

    await root.agent.runTurn('default', session, 'Tôi muốn khiếu nại vì sự cố mạng')
    const matchedMsgs = capturedMessages[0]
    const supportNote = matchedMsgs.find((m) => m.role === 'system' && m.content.includes('xác nhận đã hiểu đúng vấn đề'))
    expect(supportNote).toBeDefined()

    await root.agent.runTurn('default', session, 'hôm nay thời tiết thế nào')
    const unmatchedMsgs = capturedMessages[1]
    expect(unmatchedMsgs.some((m) => m.role === 'system' && m.content.includes('xác nhận đã hiểu đúng vấn đề'))).toBe(false)

    // session.history KHÔNG lưu note skill (chỉ chèn ephemeral lúc buildPrompt) —
    // xem chú thích tại seams/loop.ts Session.buildPrompt().
    expect(session.history.some((m) => m.content.includes('xác nhận đã hiểu đúng vấn đề'))).toBe(false)
  })
})
