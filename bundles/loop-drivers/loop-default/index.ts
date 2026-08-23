// bundles/loop-default — Phase 4: agent loop mặc định (model ↔ tool ↔ storage).
//
// Chỉ inject `loop` — bundle này CHỈ đăng ký driver, không tự gọi llm/storage/
// tools qua ctx của chính apply() (xem coding rule A12 trong seams/loop.ts).
// Logic thật trong `runTurn` nhận `runCtx` làm tham số từ caller ổn định
// (bundles/agent-runner), để driver này có thể bị dispose (hot-swap ở Phase
// 5) giữa lúc 1 turn khác đang chạy dở mà KHÔNG làm turn đó throw.
//
// Coding rule B3: mỗi bước ghi `model_message` NGAY sau khi model trả lời,
// và `tool_result` NGAY sau khi tool chạy xong — trước khi qua bước kế tiếp.
// Coding rule B6: toàn bộ việc ráp prompt nằm trong Session (seams/loop.ts),
// loop-default chỉ gọi session.buildPrompt()/recordAssistant()/recordToolResult().
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/llm.ts'
import '../../../seams/storage.ts'
import '../../../seams/tools.ts'
import '../../../seams/loop.ts'
import '../../../seams/skill.ts'
import { MemoryEntry } from '../../../seams/memory.ts'
import { LoopTurnResult, Session, TurnInput } from '../../../seams/loop.ts'

export const inject = ['loop']

export const apply = (ctx: Context) => {
  ctx.loop.register('default', {
    async runTurn(runCtx: Context, session: Session, input: TurnInput): Promise<LoopTurnResult> {
      const userMessage = input.message
      // Phase 15: skill match trên ĐÚNG tin nhắn user của lượt này — driver
      // không tự ráp prompt, chỉ đưa instructions đã match vào buildPrompt()
      // (coding rule B6, xem chú thích tại seams/loop.ts).
      const matchedSkills = runCtx.skills.match(userMessage)
      // Memory integration: `ctx.memory` KHÔNG nằm trong `inject` (seam optional
      // -- chỉ mount khi MEMORY_CORE_URL được cấu hình, xem src/serve.ts).
      // Dùng `ctx.get('memory')` (API chính thức Cordis, đọc service KHÔNG
      // cần inject, trả `undefined` êm ái nếu chưa mount) thay vì đọc property
      // `runCtx.memory` trực tiếp -- property access THROW ngay cả khi
      // service ĐÃ mount ở nơi khác, vì Cordis gate theo inject của ĐÚNG
      // fiber đang đọc, không theo "có tồn tại trong app hay không". Gap này
      // xác nhận thật bằng verify Docker end-to-end (không phải giả thuyết):
      // memory-tencentdb mount thành công nhưng recall() không bao giờ tới
      // được provider khi còn dùng optional-chaining + try/catch quanh
      // property access (xem chú thích đầy đủ hơn tại bundles/providers/
      // agent-runner). `recall()` bản thân đã best-effort (log-and-swallow
      // bên trong provider), nên không cần try/catch ở đây nữa.
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
        // Phase 8.5: tra ui hint NGAY LÚC PHÁT step — chỉ forward metadata đã
        // khai sẵn trên ToolDefinition, không tự quyết định cách hiển thị.
        const tool = response.toolCall ? runCtx.tools.get(response.toolCall.name) : undefined
        await runCtx.storage.appendEvent(session.id, {
          type: 'model_message',
          content: response.content,
          toolCall: response.toolCall,
          // Sidebar/resume session (thêm sau audit UI): trước đây toolUi CHỈ
          // phát qua 'agent/step' live, KHÔNG lưu storage — resume 1 session
          // cũ qua GET /sessions/:id/events sẽ mất icon/label/citations. Lưu
          // luôn ở đây, cùng giá trị đã tính cho 'agent/step' ngay phía dưới.
          toolUi: tool?.ui,
        })
        runCtx.emit('agent/step', {
          sessionId: session.id,
          step: { type: 'model_message', content: response.content, toolCall: response.toolCall, toolUi: tool?.ui },
        })
        session.recordAssistant(response.content, response.toolCall)

        if (!response.toolCall) {
          runCtx.emit('agent/step', { sessionId: session.id, step: { type: 'final', content: response.content } })
          return { content: response.content, steps }
        }

        const result = tool
          ? await runCtx.tools.invoke(response.toolCall.name, response.toolCall.args, {
              sessionId: session.id,
              source: 'default-loop',
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

  ctx.logger('loop-default').info('activated')
}
