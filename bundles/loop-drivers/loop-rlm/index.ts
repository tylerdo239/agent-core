import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/sandbox.ts'
import '../../../seams/storage.ts'
import '../../../seams/skill.ts'
import '../../../seams/prompt.ts'
import '../../../seams/workspace.ts'
import '../../../seams/turn-memory.ts'
import '../../../seams/skill-selection.ts'
import { assertNotCancelled, LoopStep, LoopTurnResult, Session, TurnInput } from '../../../seams/loop.ts'
import { SandboxEvent } from '../../../seams/sandbox.ts'
import { classifyError, isHarnessErrorCode } from '../../../src/errors.ts'
import { prepareRlmTurn, RlmSessionState } from './protocol.ts'
import { resolveActiveSkills } from '../../../src/skill-runtime.ts'

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toStep(event: SandboxEvent): LoopStep | undefined {
  const iteration = number(event.iteration)
  const block = number(event.block)
  switch (event.type) {
    case 'turn_started':
      return { type: 'turn_started', runId: String(event.run_id ?? ''), contextIndex: number(event.context_index) }
    case 'iteration_started':
    case 'iteration_completed':
      return {
        type: event.type,
        iteration: iteration ?? 0,
        depth: number(event.depth),
        duration: number(event.duration ?? event.execution_time),
      }
    case 'analysis':
      return {
        type: 'analysis',
        content: String(event.content ?? ''),
        iteration,
        decisionSummary: typeof event.decision_summary === 'string' ? event.decision_summary : undefined,
      }
    case 'skill_loaded':
    case 'skill_resource':
      return {
        type: event.type,
        skill: String(event.skill ?? ''),
        path: typeof event.path === 'string' ? event.path : undefined,
        encoding: typeof event.encoding === 'string' ? event.encoding : undefined,
      }
    case 'workspace_read':
      return {
        type: 'workspace_read',
        action: String(event.action ?? 'read'),
        path: typeof event.path === 'string' ? event.path : undefined,
      }
    case 'workspace_write':
      return { type: 'workspace_write', path: String(event.path ?? '') }
    case 'code':
      return { type: 'code', code: String(event.code ?? ''), iteration, block }
    case 'observation':
      return {
        type: 'observation',
        stdout: String(event.stdout ?? ''),
        stderr: String(event.stderr ?? ''),
        success: Boolean(event.success),
        iteration,
        block,
      }
    case 'tool_call':
      return {
        type: 'tool_call',
        name: String(event.name ?? ''),
        args: record(event.args),
        toolUi: record(event.toolUi),
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        name: String(event.name ?? ''),
        result: event.result,
        toolUi: record(event.toolUi),
      }
    case 'subcall_result': {
      const { type: _type, ...data } = event
      return { type: 'subcall_result', data }
    }
    case 'context_usage': {
      const { type: _type, ...data } = event
      return { type: 'context_usage', data }
    }
    case 'memory_updated': {
      const { type: _type, ...data } = event
      return { type: 'memory_updated', data }
    }
    case 'human_decision': {
      const { type: _type, ...control } = event
      return { type: 'human_decision', control }
    }
    case 'final_answer':
      return { type: 'final', content: String(event.content ?? '') }
    case 'error':
      return { type: 'error', message: String(event.message ?? 'RLM worker failed') }
    default:
      return undefined
  }
}

/**
 * The notebook is intentionally a normal Python REPL, so arbitrary Python
 * cannot be perfectly observed. The harness helpers are the supported file
 * boundary; turn their calls into timeline events before executing the cell.
 * The following observation event then tells the UI whether the attempt
 * succeeded. This is much clearer than asking the UI to parse code/stdout.
 */
function workspaceActivities(code: string): SandboxEvent[] {
  const activities: SandboxEvent[] = []
  const seen = new Set<string>()
  const add = (action: string, path?: string) => {
    const key = `${action}:${path ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    activities.push({ type: 'workspace_read', action, ...(path ? { path } : {}) })
  }
  const capture = (name: string, action: string) => {
    const pattern = new RegExp(`\\b${name}\\(\\s*['"]([^'"]+)['"]`)
    const match = pattern.exec(code)
    if (match) add(action, match[1])
    else if (new RegExp(`\\b${name}\\(`).test(code)) add(action)
  }
  capture('load_dataset', 'load dataset')
  capture('profile_dataset', 'profile dataset')
  capture('read_workspace_file', 'read file')
  if (/\blist_workspace_files\s*\(/.test(code)) add('list files')
  if (/\blist_datasets\s*\(/.test(code)) add('list datasets')
  const saved = /\bsave_artifact\(\s*['"]([^'"]+)['"]/.exec(code)
  if (saved) activities.push({ type: 'workspace_write', path: `generated/${saved[1].replace(/^generated\//, '')}` })
  const directRead = /\b(?:pd\.)?read_(?:csv|tsv|excel|parquet)\(\s*['"]([^'"]+)['"]/.exec(code)
  if (directRead) add('read file', directRead[1])
  const openRead = /\bopen\(\s*['"]([^'"]+)['"]\s*,\s*['"][rt]/.exec(code)
  if (openRead) add('read file', openRead[1])
  const directWrite = /\.to_(?:csv|excel|parquet|json)\(\s*['"]([^'"]+)['"]/.exec(code)
  if (directWrite) activities.push({ type: 'workspace_write', path: directWrite[1] })
  const openWrite = /\bopen\(\s*['"]([^'"]+)['"]\s*,\s*['"][waxt]/.exec(code)
  if (openWrite) activities.push({ type: 'workspace_write', path: openWrite[1] })
  return activities
}

export const inject = ['loop']

export const apply = (ctx: Context) => {
  ctx.loop.register('rlm', {
    async runTurn(runCtx: Context, session: Session, input: TurnInput): Promise<LoopTurnResult> {
      assertNotCancelled(input)
      // sandbox/workspace chỉ bắt buộc với driver này, không phải với
      // AgentRunner/loop-default. ctx.get() giữ dependency boundary ở đúng
      // plugin cần capability và fail rõ nếu composition thiếu provider.
      const sandbox = runCtx.get('sandbox')
      const workspace = runCtx.get('workspace')
      // Merge RLM harness (docs/agent-core-rlm-harness-merge-plan.md mục
      // 4.1): capability rolling-summary theo session tách khỏi `ctx.memory`
      // (remember/recall xuyên session/user qua TencentDB Agent Memory,
      // Phase 25) sang seam riêng `ctx.turnMemory` — 2 khái niệm khác nhau,
      // không ép chung 1 interface.
      const memoryService = runCtx.get('turnMemory')
      const prompts = runCtx.get('prompts')
      if (!sandbox || !workspace || !memoryService || !prompts) {
        throw new Error('loop-rlm requires sandbox, workspace, turnMemory and prompt providers')
      }
      // Explicit user selection wins. Without one, a precise trigger is the
      // deterministic fast path; semantic discovery remains available through
      // the model-facing `skill` tool and catalog in the prepared context.
      const activeSkills = resolveActiveSkills(runCtx.skills, input.message, input.selectedSkill, session.ownerId)
      const skillCatalog = runCtx.skills.list({ topLevelOnly: true, visibleTo: session.ownerId })
      let active = activeSkills[0]
      if (!active) {
        const selector = runCtx.get('skillSelection')
        const semantic = await selector?.select(input.message, skillCatalog, input.signal)
        if (selector) {
          await runCtx.storage.appendEvent(session.id, {
            type: 'skill_selection', source: 'rlm', strategy: 'semantic',
            outcome: semantic?.skill ? 'selected' : 'none',
            skill: semantic?.skill?.name, model: semantic?.model, usage: semantic?.usage,
            decision: semantic?.decision,
          })
        }
        if (semantic?.skill) {
          active = { skill: semantic.skill, source: 'semantic' }
        }
      }

      await sandbox.openSession(session.id, {
        cwd: workspace.root(session.workspaceId),
        metadata: { projectId: session.projectId, workspaceId: session.workspaceId },
      })
      const prepared = await prepareRlmTurn({
        session,
        input,
        memory: memoryService,
        workspace: await workspace.inspect(session.workspaceId, session.id),
        skill: active?.skill,
        skillCatalog,
        tools: runCtx.tools.list(),
        prompts,
      })
      if (prepared.context.selected_skill && active) {
        const event = { type: 'skill_loaded', source: 'rlm', activation: active.source, skill: active.skill.name }
        await runCtx.storage.appendEvent(session.id, event)
        runCtx.emit('agent/step', {
          sessionId: session.id,
          step: { type: 'skill_loaded', skill: active.skill.name, activation: active.source },
        })
      }
      // H2: model-visible = logged — prompt hash for audit/replay (DSH invariant)
      const promptHash = createHash('sha256').update(prepared.prompt).digest('hex').slice(0, 12)
      const toolsHash = createHash('sha256').update(JSON.stringify(prepared.availableTools)).digest('hex').slice(0, 12)
      await runCtx.storage.appendEvent(session.id, {
        type: 'prompt_assembled',
        source: 'rlm',
        promptHash,
        promptVersion: prepared.promptVersion,
        toolsHash,
        promptLength: prepared.prompt.length,
        toolsCount: prepared.availableTools.length,
      } as any)
      let result: Record<string, unknown> | undefined
      let steps = 0
      let finalContent = ''

      try {
        for await (const event of sandbox.request(
          session.id,
          'prepared_turn',
          prepared as unknown as Record<string, unknown>,
          { signal: input.signal },
        )) {
          assertNotCancelled(input)
          if (event.type === '__result__') {
            result = event
            continue
          }
          if (event.type === 'code') {
            for (const activity of workspaceActivities(String(event.code ?? ''))) {
              await runCtx.storage.appendEvent(session.id, { ...activity, source: 'rlm' })
              const activityStep = toStep(activity)
              if (activityStep) runCtx.emit('agent/step', { sessionId: session.id, step: activityStep })
            }
          }
          await runCtx.storage.appendEvent(session.id, { ...event, source: 'rlm' })
          const step = toStep(event)
          if (step) runCtx.emit('agent/step', { sessionId: session.id, step })
          if (event.type === 'iteration_completed') steps++
          if (event.type === 'final_answer') finalContent = String(event.content ?? '')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // BUG-10 silent-failure: lỗi bridge/worker phải được phân loại theo
        // taxonomy VÀ ghi vào session state để TURN KẾ TIẾP nhận [SESSION
        // HEALTH] note thay vì đi tiếp như không có chuyện gì.
        const errorCode = classifyError(message)
        const state = session.extension<RlmSessionState>('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 }))
        state.lastError = { code: errorCode, message }
        await runCtx.storage.appendEvent(session.id, { type: 'error', source: 'rlm', message, error_code: errorCode })
        runCtx.emit('agent/step', { sessionId: session.id, step: { type: 'error', message } })
        throw error
      }

      if (!result) throw new Error('RLM worker ended without a turn result')
      const status = String(result.status ?? 'failed') as LoopTurnResult['status']
      const content = String(result.answer ?? finalContent ?? '')
      const memory = record(result.memory)
      const state = session.extension<RlmSessionState>('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 }))
      // BUG-10: turn_issue từ python (crash đã classify / cạn iteration /
      // CODE_PARSE...) → lưu cho turn kế tiếp; turn sạch thì xoá.
      const turnIssue = record(result.turn_issue)
      if (status === 'failed') {
        const message = String(turnIssue.message ?? result.answer ?? 'turn failed')
        state.lastError = { code: isHarnessErrorCode(turnIssue.code) ? turnIssue.code : classifyError(message), message }
      } else if (Object.keys(turnIssue).length) {
        state.lastError = { code: isHarnessErrorCode(turnIssue.code) ? turnIssue.code : undefined, message: String(turnIssue.message ?? '') }
      } else {
        state.lastError = undefined
      }
      const contextIndex = number(memory.context_index)
      const historyIndex = number(memory.history_index)
      if (contextIndex !== undefined) await memoryService.recordContext(session.id, contextIndex)
      state.contextIndex = number(memory.next_context_index) ?? state.contextIndex
      state.historyIndex = number(memory.next_history_index) ?? state.historyIndex
      const control = record(result.control)
      state.pendingControl = Object.keys(control).length ? control : undefined
      if (status !== 'failed' && Object.keys(memory).length) {
        const contexts = await memoryService.sourceContexts(session.id, contextIndex)
        const completed = await memoryService.completeTurn(session.id, {
          state: String(memory.state ?? status ?? 'completed'),
          request: String(memory.request ?? input.message),
          outcome: memory.outcome,
          trajectory: record(memory.trajectory),
          contexts,
          historyIndex,
        })
        const event = {
          type: 'memory_updated',
          source: 'rlm',
          quality: completed.update.quality,
          summary: completed.update.summary,
          turn: completed.turn,
        }
        await runCtx.storage.appendEvent(session.id, event)
        runCtx.emit('agent/step', {
          sessionId: session.id,
          step: { type: 'memory_updated', data: event },
        })
      }
      if (status === 'completed') session.recordAssistant(content)
      return {
        content,
        steps,
        status,
        control: Object.keys(control).length ? control : undefined,
        usage: record(result.usage),
        tracePath: typeof result.trace_path === 'string' ? result.trace_path : undefined,
      }
    },
  })

  ctx.logger('loop-rlm').info('activated')
}
