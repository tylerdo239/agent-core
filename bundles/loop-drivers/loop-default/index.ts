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
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/llm.ts'
import '../../../seams/storage.ts'
import '../../../seams/tools.ts'
import '../../../seams/loop.ts'
import '../../../seams/skill.ts'
import '../../../seams/prompt.ts'
import '../../../seams/context-compactor.ts'
import { MemoryEntry } from '../../../seams/memory.ts'
import { assertNotCancelled, LoopTurnResult, Session, TurnInput } from '../../../seams/loop.ts'
import { ToolExecutionError } from '../../../seams/tools.ts'
import { resolveActiveSkills, skillCatalogGuidance } from '../../../src/skill-runtime.ts'

export const inject = ['loop']

export const apply = (ctx: Context) => {
  ctx.loop.register('default', {
    async runTurn(runCtx: Context, session: Session, input: TurnInput): Promise<LoopTurnResult> {
      const userMessage = input.message
      const prompts = runCtx.get('prompts')
      const contextCompactor = runCtx.get('contextCompactor')
      if (!prompts || !contextCompactor) {
        throw new Error('loop-default requires prompt and contextCompactor providers')
      }
      session.manageHistoryByTokenCompaction()
      const frameworkPrompt = prompts.render({ driver: 'default', sessionId: session.id })
      const activeSkills = resolveActiveSkills(runCtx.skills, userMessage, input.selectedSkill)
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
      const turnNotes = () => [
        skillCatalogGuidance(
          runCtx.skills.list({ topLevelOnly: true }),
          input.selectedSkill,
          runCtx.tools.has('skill'),
        ),
        ...activeSkills.map(({ skill }) => skill.instructions),
        ...memoryNotes,
      ].filter(Boolean)
      for (const { skill, source } of activeSkills) {
        const event = { type: 'skill_loaded', source: 'default-loop', activation: source, skill: skill.name }
        await runCtx.storage.appendEvent(session.id, event)
        runCtx.emit('agent/step', {
          sessionId: session.id,
          step: { type: 'skill_loaded', skill: skill.name, activation: source },
        })
      }
      let messages = session.buildPrompt(userMessage, turnNotes(), frameworkPrompt.content)
      let steps = 0
      let compactionCount = 0
      let usage: { inputTokens: number; outputTokens: number; totalTokens: number; cost: number } | undefined

      while (steps < session.maxSteps) {
        assertNotCancelled(input)
        const toolSpecs = runCtx.tools.list().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }))

        const usageEvent = (phase: string) => {
          const inspected = contextCompactor.inspect(messages, toolSpecs)
          return {
            type: 'context_usage',
            source: 'default-loop',
            phase,
            current_context_tokens: inspected.estimatedTokens,
            context_limit_tokens: inspected.contextLimitTokens,
            context_usage_percent: Math.round(inspected.estimatedTokens / inspected.contextLimitTokens * 10_000) / 100,
            compaction_trigger_tokens: inspected.compactionTriggerTokens,
            compaction_progress_percent: inspected.compactionProgressPercent,
            near_compaction: inspected.nearCompaction,
            compaction_count: compactionCount,
            should_compact: inspected.shouldCompact,
          }
        }
        let contextUsage = usageEvent('before_model')
        if (contextUsage.near_compaction) {
          await runCtx.storage.appendEvent(session.id, contextUsage)
          runCtx.emit('agent/step', {
            sessionId: session.id,
            step: { type: 'context_usage', data: contextUsage },
          })
        }
        if (contextUsage.should_compact) {
          assertNotCancelled(input)
          const compacted = await contextCompactor.compact(session.history, { signal: input.signal })
          assertNotCancelled(input)
          session.replaceHistory(compacted.messages)
          compactionCount++
          messages = session.currentPrompt(turnNotes(), frameworkPrompt.content)
          const after = contextCompactor.inspect(messages, toolSpecs)
          const compactedEvent = {
            type: 'context_compacted',
            source: 'default-loop',
            iteration: steps + 1,
            before_tokens: contextUsage.current_context_tokens,
            after_tokens: after.estimatedTokens,
            compaction_count: compactionCount,
            quality: compacted.quality,
            // Durable replay: event log trước compact vẫn còn để audit, nhưng
            // SessionRegistry gặp checkpoint này sẽ reset model history về
            // đúng summary + current request rồi mới replay event phía sau.
            history: compacted.messages.filter((message) => message.role !== 'system'),
            ...(compacted.error ? { error: compacted.error } : {}),
          }
          await runCtx.storage.appendEvent(session.id, compactedEvent)
          contextUsage = usageEvent('after_compaction')
          await runCtx.storage.appendEvent(session.id, contextUsage)
          runCtx.emit('agent/step', {
            sessionId: session.id,
            step: { type: 'context_usage', data: contextUsage },
          })
          if (contextUsage.should_compact) {
            throw new Error(
              `default-loop context remains above compaction threshold after compacting `
              + `(${contextUsage.current_context_tokens}/${contextUsage.compaction_trigger_tokens} estimated tokens)`,
            )
          }
        }

        // Persist the exact model-visible prompt/tool composition for replay
        // and regression diagnosis. Providers may change while a session is
        // alive, so this snapshot is taken at every step.
        await runCtx.storage.appendEvent(session.id, {
          type: 'prompt_assembled', source: 'default-loop', iteration: steps + 1,
          promptHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 12),
          systemPromptVersion: frameworkPrompt.version,
          toolsHash: createHash('sha256').update(JSON.stringify(toolSpecs)).digest('hex').slice(0, 12),
          messagesCount: messages.length, toolsCount: toolSpecs.length,
        })

        const response = await runCtx.llm.complete(messages, { tools: toolSpecs, signal: input.signal })
        assertNotCancelled(input)
        if (response.usage) {
          usage ??= { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
          usage.inputTokens += response.usage.inputTokens ?? 0
          usage.outputTokens += response.usage.outputTokens ?? 0
          usage.totalTokens += response.usage.totalTokens ?? 0
          usage.cost += response.usage.cost ?? 0
        }
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
          return { content: response.content, steps, ...(usage ? { usage } : {}) }
        }

        let result: unknown
        try {
          result = tool
            ? await runCtx.tools.invoke(response.toolCall.name, response.toolCall.args, {
                sessionId: session.id,
                source: 'default-loop',
                runId: input.runId,
                signal: input.signal,
              })
            : { error: `tool "${response.toolCall.name}" not found`, code: 'TOOL_NOT_FOUND' }
        } catch (error) {
          assertNotCancelled(input)
          // Tool failure is a model-visible observation, not a reason to lose
          // the whole turn. The model may repair its arguments or choose a
          // different path on the next step.
          result = error instanceof ToolExecutionError
            ? { error: error.message, code: error.code }
            : { error: error instanceof Error ? error.message : String(error), code: 'TOOL_HANDLER_ERROR' }
        }
        assertNotCancelled(input)

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
        // Skill catalog, selected/triggered instructions and recalled memory
        // are ephemeral turn guidance, but must survive every tool step.
        messages = session.currentPrompt(turnNotes(), frameworkPrompt.content)
      }

      const message = `session "${session.id}" exceeded maxSteps (${session.maxSteps})`
      await runCtx.storage.appendEvent(session.id, { type: 'error', source: 'default-loop', message })
      runCtx.emit('agent/step', { sessionId: session.id, step: { type: 'error', message } })
      throw new Error(message)
    },
  })

  ctx.logger('loop-default').info('activated')
}
