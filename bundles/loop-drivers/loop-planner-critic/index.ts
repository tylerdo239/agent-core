// bundles/loop-planner-critic — Phase 5: driver THỨ HAI, đăng ký dưới CÙNG
// tên 'default' như bundles/loop-default — để "swap" có ý nghĩa (đổi driver
// nào đứng sau tên 'default', không phải thêm tên mới).
//
// Khác biệt hành vi so với loop-default (để chaos test khẳng định được
// session nào dùng driver nào mà không cần dò state nội bộ): trước khi chốt
// câu trả lời cuối, gọi thêm 1 lượt LLM "phê bình" rồi mới trả kết quả, tiền
// tố "[reviewed]". Ghi thêm 1 event `critic_message` — vẫn tuân rule B3
// (ghi storage trước khi qua bước kế tiếp).
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/llm.ts'
import '../../../seams/storage.ts'
import '../../../seams/tools.ts'
import '../../../seams/loop.ts'
import '../../../seams/skill.ts'
import { MemoryEntry } from '../../../seams/memory.ts'
import { LoopTurnResult, Session, TurnInput } from '../../../seams/loop.ts'

export const inject = ['loop']

const CRITIQUE_PROMPT = 'Hãy rà soát câu trả lời trên, chỉ ra vấn đề nếu có, rồi đưa câu trả lời CUỐI CÙNG.'

export const apply = (ctx: Context) => {
  ctx.loop.register('default', {
    async runTurn(runCtx: Context, session: Session, input: TurnInput): Promise<LoopTurnResult> {
      const userMessage = input.message
      // Phase 15: cùng cơ chế skill-match như loop-default, xem chú thích ở đó.
      const matchedSkills = runCtx.skills.match(userMessage)
      // Memory integration: cùng cơ chế `ctx.get('memory')` (API chính thức
      // Cordis, không throw khi chưa mount) như loop-default -- xem chú
      // thích đầy đủ ở đó và tại bundles/providers/agent-runner.
      const recalled: MemoryEntry[] =
        (await runCtx.get('memory')?.recall(session.id, userMessage, 3, { userId: session.ownerId })) ?? []
      const memoryNotes = recalled.map((m) => `Đã ghi nhớ trước đó: ${m.text}`)
      let messages = session.buildPrompt(userMessage, [...matchedSkills.map((s) => s.instructions), ...memoryNotes])
      let steps = 0

      while (steps < session.maxSteps) {
        const toolSpecs = runCtx.tools.list().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }))

        const response = await runCtx.llm.complete(messages, { tools: toolSpecs })
        // Phase 8.5: xem ghi chú tương ứng trong loop-default.
        const tool = response.toolCall ? runCtx.tools.get(response.toolCall.name) : undefined
        await runCtx.storage.appendEvent(session.id, {
          type: 'model_message',
          content: response.content,
          toolCall: response.toolCall,
          toolUi: tool?.ui,
        })
        runCtx.emit('agent/step', {
          sessionId: session.id,
          step: { type: 'model_message', content: response.content, toolCall: response.toolCall, toolUi: tool?.ui },
        })
        session.recordAssistant(response.content, response.toolCall)

        if (!response.toolCall) {
          const critique = await runCtx.llm.complete(
            [...session.history, { role: 'user', content: CRITIQUE_PROMPT }],
            { tools: [] },
          )
          await runCtx.storage.appendEvent(session.id, {
            type: 'critic_message',
            content: critique.content,
          })
          runCtx.emit('agent/step', {
            sessionId: session.id,
            step: { type: 'critic_message', content: critique.content },
          })
          session.recordAssistant(critique.content)

          const finalContent = `[reviewed] ${critique.content}`
          runCtx.emit('agent/step', { sessionId: session.id, step: { type: 'final', content: finalContent } })
          return { content: finalContent, steps: steps + 1 }
        }

        const result = tool
          ? await runCtx.tools.invoke(response.toolCall.name, response.toolCall.args, {
              sessionId: session.id,
              source: 'planner-critic',
            })
          : { error: `tool "${response.toolCall.name}" not found` }

        await runCtx.storage.appendEvent(session.id, {
          type: 'tool_result',
          name: response.toolCall.name,
          result,
          toolUi: tool?.ui,
        })
        runCtx.emit('agent/step', {
          sessionId: session.id,
          step: { type: 'tool_result', name: response.toolCall.name, result, toolUi: tool?.ui },
        })
        session.recordToolResult(response.toolCall.name, result)

        steps++
        messages = [...session.history]
      }

      throw new Error(`session "${session.id}" exceeded maxSteps (${session.maxSteps})`)
    },
  })

  ctx.logger('loop-planner-critic').info('activated')
}
