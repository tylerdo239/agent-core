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
import { sanitizeEventField, stripLeakedToolCallLabels } from '../../../src/leaked-tool-call-label.ts'
import { prepareRlmTurn, RlmSessionState } from './protocol.ts'
import { resolveActiveSkills, buildSkillRouterQuery } from '../../../src/skill-runtime.ts'

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
        // analysis render thẳng ra UI ('🧠 Think') — strip nhãn nội bộ model
        // vô tình nhúng giữa text (bug user báo ở skill_resource, cùng họ).
        content: stripLeakedToolCallLabels(String(event.content ?? '')),
        iteration,
        decisionSummary: typeof event.decision_summary === 'string' ? event.decision_summary : undefined,
      }
    case 'skill_loaded':
    case 'skill_resource':
      return {
        type: event.type,
        // skill/path do model truyền (arg của skill_resource()) — sanitize để
        // path bẩn kiểu `refs/a.md.\n[tool_call:web_search({...})]` không chảy
        // verbatim ra UI (bug user báo) lẫn storage/resume.
        skill: sanitizeEventField(event.skill),
        path: typeof event.path === 'string' ? sanitizeEventField(event.path) : undefined,
        encoding: typeof event.encoding === 'string' ? event.encoding : undefined,
      }
    case 'workspace_read':
      return {
        type: 'workspace_read',
        action: sanitizeEventField(event.action ?? 'read'),
        path: typeof event.path === 'string' ? sanitizeEventField(event.path) : undefined,
      }
    case 'workspace_write':
      return { type: 'workspace_write', path: sanitizeEventField(event.path ?? '') }
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
        name: sanitizeEventField(event.name ?? ''),
        args: record(event.args),
        toolUi: record(event.toolUi),
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        name: sanitizeEventField(event.name ?? ''),
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
      return { type: 'final', content: stripLeakedToolCallLabels(String(event.content ?? '')) }
    case 'error':
      return { type: 'error', message: stripLeakedToolCallLabels(String(event.message ?? 'RLM worker failed')) }
    default:
      return undefined
  }
}

/**
 * Nhãn nội bộ `[tool_call:...]` do model nhúng vào field hiển thị (skill/path/
 * action/name/content/message) phải được lột TRƯỚC KHI lưu storage — nếu chỉ
 * sanitize ở toStep (live emit), resume session cũ qua GET /events vẫn đọc
 * event thô và hiện rác (đúng bug user báo). `code`/`observation`/`args` giữ
 * nguyên verbatim để bảo toàn audit fidelity (đó là data, không phải descriptor).
 */
function sanitizeRlmEvent(event: SandboxEvent): SandboxEvent {
  const clean: SandboxEvent = { ...event }
  if (typeof clean.skill === 'string') clean.skill = sanitizeEventField(clean.skill)
  if (typeof clean.path === 'string') clean.path = sanitizeEventField(clean.path)
  if (typeof clean.action === 'string') clean.action = sanitizeEventField(clean.action)
  if (typeof clean.name === 'string') clean.name = sanitizeEventField(clean.name)
  if (typeof clean.content === 'string') clean.content = stripLeakedToolCallLabels(clean.content)
  if (typeof clean.message === 'string') clean.message = stripLeakedToolCallLabels(clean.message)
  return clean
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

export namespace LoopRlm {
  export interface Config {
    /**
     * Hạn chót TUYỆT ĐỐI cho một turn RLM, tính từ lúc gửi `prepared_turn`.
     * Xem chú thích ở watchdog trong runTurn để biết vì sao phải có lớp này.
     */
    turnDeadlineMs?: number
  }
}

/**
 * 10 phút: dài hơn hẳn `RLM_MAX_TIMEOUT` (mặc định 300s) cộng dư địa cho
 * compaction/subcall, nên turn chạy đàng hoàng không bao giờ chạm tới. Đây là
 * lưới an toàn cho trường hợp KẸT, không phải hạn mức vận hành.
 */
const DEFAULT_TURN_DEADLINE_MS = 600_000

export const inject = ['loop']

/** Tên driver đăng ký với ctx.loop; cũng là khoá lọc SkillDefinition.drivers. */
const DRIVER = 'rlm'

export const apply = (ctx: Context, config: LoopRlm.Config = {}) => {
  const turnDeadlineMs = config.turnDeadlineMs ?? DEFAULT_TURN_DEADLINE_MS
  ctx.loop.register(DRIVER, {
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
      const activeSkills = resolveActiveSkills(runCtx.skills, input.message, input.selectedSkill, session.ownerId, DRIVER)
      const skillCatalog = runCtx.skills.list({ topLevelOnly: true, visibleTo: session.ownerId, driver: DRIVER })
      let active = activeSkills[0]
      if (!active) {
        const selector = runCtx.get('skillSelection')
        // Như loop-default: enrich router query bằng rolling summary có sẵn
        // của turnMemory (best-effort — summary rỗng/lỗi thì query nguyên
        // message). Không thêm seam/provider mới.
        let routerQuery = input.message
        try {
          const memSummary = await memoryService.summary(session.id)
          if (memSummary?.trim()) routerQuery = buildSkillRouterQuery(input.message, { summary: memSummary })
        } catch {
          // summary lỗi -> router chạy mù như cũ, turn không ảnh hưởng
        }
        // Như loop-default: router sập không được sập turn — catalog vẫn nằm
        // trong prepared context để model tự gọi tool `skill`.
        let semantic: Awaited<ReturnType<NonNullable<typeof selector>['select']>> | undefined
        let selectorError: string | undefined
        try {
          semantic = await selector?.select(routerQuery, skillCatalog, input.signal)
        } catch (error) {
          selectorError = error instanceof Error ? error.message : String(error)
          runCtx.logger('loop-rlm').warn('skill router failed, continuing without semantic skill: %s', selectorError)
        }
        if (selector) {
          await runCtx.storage.appendEvent(session.id, {
            type: 'skill_selection', source: 'rlm', strategy: 'semantic',
            outcome: selectorError ? 'error' : semantic?.skill ? 'selected' : 'none',
            skill: semantic?.skill?.name, model: semantic?.model, usage: semantic?.usage,
            decision: semantic?.decision,
            ...(selectorError ? { error: selectorError } : {}),
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

      // Watchdog phía TS — lớp timeout DUY NHẤT phủ được mọi kiểu kẹt của
      // worker Python, vì nó không phụ thuộc worker còn sống hay không.
      //
      // Bug thật (user báo: turn chạy 25+ phút, không throw, không event, worker
      // utime=0). Ba lớp timeout tưởng là có đều KHÔNG nằm trên đường bị kẹt:
      //   - `max_timeout` chỉ là câu `if` ở ĐẦU mỗi vòng lặp iteration
      //     (vendor/rlm/rlm/core/rlm.py: `_check_timeout(i, time_start)`), nên
      //     kẹt BÊN TRONG một iteration thì nó không bao giờ được chạy tới;
      //   - `cell_timeout` chỉ phủ ô REPL, không biết gì về cầu nối host;
      //   - cầu nối host trong python/worker.py chờ `sys.stdin.readline()`
      //     CHẶN VÔ HẠN, không có deadline nào cả.
      // Hệ quả kèm theo: agent-runner xâu chuỗi turn theo session, nên một
      // driver treo làm mọi turn sau của session đó kẹt vĩnh viễn — không lỗi,
      // không log, user chỉ thấy loading.
      //
      // Abort signal này đi thẳng vào `sandbox.request`, nơi handler abort có
      // sẵn vừa fail queue vừa `closeSession()` để GIẾT worker — không để lại
      // process zombie giữ session.
      // Nhịp tim từ worker: KHÔNG lưu vào storage (mỗi turn có thể có hàng
      // chục mốc, lưu hết là phình event vô ích) — chỉ giữ mốc gần nhất để
      // thông điệp hết-hạn-chót nói được KẸT Ở ĐÂU, thay vì chỉ "nó treo".
      let lastHeartbeat: string | undefined
      const turnStartedAt = Date.now()

      const watchdog = new AbortController()
      let deadlineExceeded = false
      const watchdogTimer = setTimeout(() => {
        deadlineExceeded = true
        watchdog.abort(new Error(`rlm turn exceeded ${turnDeadlineMs}ms deadline`))
      }, turnDeadlineMs)
      watchdogTimer.unref?.()
      const turnSignal = input.signal
        ? AbortSignal.any([input.signal, watchdog.signal])
        : watchdog.signal

      try {
        for await (const event of sandbox.request(
          session.id,
          'prepared_turn',
          prepared as unknown as Record<string, unknown>,
          { signal: turnSignal },
        )) {
          assertNotCancelled(input)
          if (event.type === '__result__') {
            result = event
            continue
          }
          if (event.type === 'heartbeat') {
            const detail = [event.phase, event.bridge && `bridge=${event.bridge}`, event.operation && `op=${event.operation}`]
              .filter(Boolean).join(' ')
            lastHeartbeat = `${detail} (+${Math.round((Date.now() - turnStartedAt) / 1000)}s)`
            continue
          }
          if (event.type === 'code') {
            for (const activity of workspaceActivities(String(event.code ?? ''))) {
              await runCtx.storage.appendEvent(session.id, { ...activity, source: 'rlm' })
              const activityStep = toStep(activity)
              if (activityStep) runCtx.emit('agent/step', { sessionId: session.id, step: activityStep })
            }
          }
          // Sanitize TRƯỚC KHI lưu (xem sanitizeRlmEvent): storage là nguồn
          // sự thật cho resume — event bẩn lọt vào đây là UI hiện rác vĩnh viễn.
          const cleanEvent = sanitizeRlmEvent(event)
          await runCtx.storage.appendEvent(session.id, { ...cleanEvent, source: 'rlm' })
          const step = toStep(cleanEvent)
          if (step) runCtx.emit('agent/step', { sessionId: session.id, step })
          if (event.type === 'iteration_completed') steps++
          if (event.type === 'final_answer') finalContent = stripLeakedToolCallLabels(String(event.content ?? ''))
        }
      } catch (error) {
        // Hết hạn chót nổi lên ở đây dưới dạng AbortError của sandbox ("sandbox
        // request cancelled") — nuốt nguyên chuỗi đó thì log/UI đọc như user tự
        // bấm huỷ. Thay bằng thông điệp và mã TIMEOUT đúng bản chất; huỷ thật
        // do caller vẫn đi đường cũ.
        const message = deadlineExceeded
          ? `RLM turn bị cắt vì quá hạn chót ${turnDeadlineMs}ms (worker đã bị đóng)`
            + (lastHeartbeat ? `. Mốc cuối worker báo: ${lastHeartbeat}` : '. Worker không báo mốc nào — kẹt trước cả lệnh đầu tiên')
          : error instanceof Error ? error.message : String(error)
        // BUG-10 silent-failure: lỗi bridge/worker phải được phân loại theo
        // taxonomy VÀ ghi vào session state để TURN KẾ TIẾP nhận [SESSION
        // HEALTH] note thay vì đi tiếp như không có chuyện gì.
        const errorCode = deadlineExceeded ? 'TIMEOUT' : classifyError(message)
        const state = session.extension<RlmSessionState>('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 }))
        state.lastError = { code: errorCode, message }
        await runCtx.storage.appendEvent(session.id, { type: 'error', source: 'rlm', message, error_code: errorCode })
        runCtx.emit('agent/step', { sessionId: session.id, step: { type: 'error', message } })
        throw deadlineExceeded ? Object.assign(new Error(message), { code: errorCode }) : error
      } finally {
        clearTimeout(watchdogTimer)
      }

      if (!result) throw new Error('RLM worker ended without a turn result')
      const status = String(result.status ?? 'failed') as LoopTurnResult['status']
      // answer từ Python có thể nhúng nhãn nội bộ model echo — strip trước
      // khi trả về caller (REST/WS/gRPC) lẫn recordAssistant ngay dưới.
      const content = stripLeakedToolCallLabels(String(result.answer ?? finalContent ?? ''))
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
