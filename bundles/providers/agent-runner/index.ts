import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import '../../../seams/llm.ts'
import '../../../seams/storage.ts'
import '../../../seams/tools.ts'
import '../../../seams/loop.ts'
import '../../../seams/skill.ts'
import '../../../seams/memory.ts'
import { AgentRunnerService } from '../../../seams/agent.ts'
import {
  isCancellation, type LoopDriver, type LoopTurnResult,
  normalizeTurnInput, RunCancelledError, Session, type TurnInput,
} from '../../../seams/loop.ts'
import type { RunRecord, RunState } from '../../../seams/storage.ts'

const DEFAULT_DRAIN_DEADLINE_MS = 10_000

interface RunEntry {
  runId: string
  session: Session
  input: TurnInput
  controller: AbortController
  promise: Promise<LoopTurnResult>
  resolve(result: LoopTurnResult): void
  reject(error: unknown): void
  detachCallerSignal?: () => void
}

/**
 * High-level owner of one request/turn.
 *
 * Runs in the same session are serialized; different sessions remain
 * independent. Cancellation is cooperative: the queue never advances until
 * the old driver has really stopped, so two turns cannot mutate one Session at
 * the same time.
 */
export class AgentRunner extends AgentRunnerService {
  private queues = new Map<string, Promise<void>>()
  private entries = new Map<string, RunEntry>()
  private volatileRuns = new Map<string, RunRecord>()
  private pendingRequests = new Map<string, Promise<LoopTurnResult>>()
  private draining = false

  async [Service.init]() {
    if (!this.ctx.storage.persistent) return
    for (const run of await this.ctx.storage.listRuns()) {
      if (run.state !== 'queued' && run.state !== 'running') continue
      run.state = 'interrupted'
      run.error = 'service restarted before run completed'
      run.updatedAt = new Date().toISOString()
      await this.ctx.storage.saveRun(run)
    }
  }

  runTurn(driverName: string, session: Session, rawInput: string | TurnInput): Promise<LoopTurnResult> {
    const input = normalizeTurnInput(rawInput)
    if (this.draining) return Promise.reject(new Error('agent-runner is draining; new runs are rejected'))
    const requestKey = input.requestId ? `${session.id}\0${input.requestId}` : undefined
    const pending = requestKey ? this.pendingRequests.get(requestKey) : undefined
    if (pending) return pending

    const promise = this.startRun(driverName, session, input)
    if (requestKey) {
      this.pendingRequests.set(requestKey, promise)
      void promise.finally(() => {
        if (this.pendingRequests.get(requestKey) === promise) this.pendingRequests.delete(requestKey)
      }).catch(() => undefined)
    }
    return promise
  }

  private async startRun(driverName: string, session: Session, input: TurnInput): Promise<LoopTurnResult> {

    if (input.requestId) {
      const existing = await this.findByRequestId(session.id, input.requestId)
      if (existing) {
        const live = this.entries.get(existing.id)
        if (live) return live.promise
        if (existing.result) return existing.result as unknown as LoopTurnResult
        throw new Error(`request "${input.requestId}" already belongs to run ${existing.id} (${existing.state})`)
      }
    }

    const driver = this.ctx.loop.get(driverName)
    if (!driver) throw new Error(`loop driver "${driverName}" not found`)

    const runId = randomUUID()
    const now = new Date().toISOString()
    await this.saveRun({
      id: runId, sessionId: session.id, requestId: input.requestId,
      driver: driverName, state: 'queued', createdAt: now, updatedAt: now,
    })

    const controller = new AbortController()
    let detachCallerSignal: (() => void) | undefined
    if (input.signal) {
      const abort = () => controller.abort(input.signal?.reason ?? new RunCancelledError())
      if (input.signal.aborted) abort()
      else {
        input.signal.addEventListener('abort', abort, { once: true })
        detachCallerSignal = () => input.signal?.removeEventListener('abort', abort)
      }
    }

    let resolve!: (result: LoopTurnResult) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<LoopTurnResult>((res, rej) => { resolve = res; reject = rej })
    const entry: RunEntry = { runId, session, input, controller, promise, resolve, reject, detachCallerSignal }
    this.entries.set(runId, entry)

    const previous = this.queues.get(session.id) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(() => this.execute(entry, driver))
    this.queues.set(session.id, task)
    void task.finally(() => {
      if (this.queues.get(session.id) === task) this.queues.delete(session.id)
    })
    return promise
  }

  private async execute(entry: RunEntry, driver: LoopDriver): Promise<void> {
    const { runId, session, controller } = entry
    try {
      if (controller.signal.aborted) throw new RunCancelledError('run cancelled while queued')
      await this.transition(runId, 'running')
      const correlated = this.ctx.storage.persistent ? { runId } : {}
      await this.ctx.storage.appendEvent(session.id, {
        type: 'user_message', content: entry.input.message,
        selectedSkill: entry.input.selectedSkill, ...correlated,
      })
      // Memory integration (Phase 25): ghi ở entrypoint chung này (coding
      // rule B4) thay vì trong từng loop driver. `ctx.memory` là seam TUỲ
      // CHỌN (chỉ mount khi MEMORY_CORE_URL cấu hình, src/serve.ts) — dùng
      // `ctx.get(name)` (API chính thức Cordis, đọc KHÔNG cần khai `inject`,
      // trả `undefined` êm ái nếu chưa mount) thay vì đọc property
      // `this.ctx.memory` trực tiếp, vốn THROW ngay cả khi service đã mount ở
      // nơi khác (Cordis gate theo `inject` của ĐÚNG fiber đang đọc — gap
      // thật đã xác nhận qua verify Docker end-to-end trước đây, không phải
      // giả thuyết). KHÔNG await remember(): ghi nền, không chặn latency của
      // turn; `.catch()` vẫn cần vì serve.ts có process.on('unhandledRejection').
      this.ctx.get('memory')?.remember(session.id, entry.input.message, { userId: session.ownerId }).catch(() => {})
      const result = await driver.runTurn(this.ctx, session, { ...entry.input, runId, signal: controller.signal })
      if (controller.signal.aborted) throw new RunCancelledError()
      // Preserve the driver's public result shape. Older drivers omit
      // `status`; RunRecord still treats that as completed internally.
      await this.finish(runId, result)
      // 'agent/turn-done'/'agent/turn-error' (seams/loop.ts): "live tap" cho
      // downlink subscriber (WS /sessions/:id/events/stream, xem bundles/
      // adapters/api-rest) biết turn đã xong mà không cần tự gọi lại
      // runTurn() — merge feat/rlm-dev-integration: bản rewrite (RunEntry/
      // queue/cancel) làm rớt 2 emit này (entry.resolve/reject đủ cho promise
      // trả về của chính lệnh POST /sessions/:id/messages, nhưng KHÔNG có gì
      // báo cho client đang nghe WS biết turn xong — gap thật phát hiện lúc
      // merge, seams/loop.ts vẫn khai 2 event này và api-rest.ts vẫn nghe).
      // Merge round 2: feature branch tự thêm LẠI 1 emit 'agent/turn-done'
      // sớm (trước finish()) + 1 emit 'agent/turn-error' vô điều kiện đầu
      // catch, độc lập không biết bản fix này đã tồn tại — gộp bằng git
      // auto-merge KHÔNG báo conflict (2 đoạn nằm NGOÀI vùng conflict thật),
      // để lại DUPLICATE: client WS nhận 'done'/'error' 2 LẦN mỗi turn (xác
      // nhận qua đọc thẳng bundles/adapters/api-rest — `ctx.on('agent/turn-done', onDone)`
      // chỉ nên fire 1 lần). Xoá bản trùng, giữ đúng 1 emit mỗi nhánh.
      this.ctx.emit('agent/turn-done', { sessionId: session.id, result })
      entry.resolve(result)
    } catch (error) {
      if (controller.signal.aborted || isCancellation(error)) {
        await this.transition(runId, 'cancelled', error instanceof Error ? error.message : 'cancelled')
        this.ctx.emit('agent/turn-error', { sessionId: session.id, message: error instanceof Error ? error.message : 'cancelled' })
        entry.reject(new RunCancelledError())
      } else {
        await this.transition(runId, 'failed', error instanceof Error ? error.message : String(error))
        this.ctx.emit('agent/turn-error', { sessionId: session.id, message: error instanceof Error ? error.message : String(error) })
        entry.reject(error)
      }
    } finally {
      entry.detachCallerSignal?.()
      this.entries.delete(runId)
    }
  }

  private async saveRun(record: RunRecord) {
    if (this.ctx.storage.persistent) await this.ctx.storage.saveRun(record)
    else {
      this.volatileRuns.set(record.id, { ...record })
      while (this.volatileRuns.size > 1000) this.volatileRuns.delete(this.volatileRuns.keys().next().value!)
    }
  }

  private async readRun(runId: string) {
    return this.ctx.storage.persistent
      ? await this.ctx.storage.getRun(runId)
      : this.volatileRuns.get(runId)
  }

  private async findByRequestId(sessionId: string, requestId: string) {
    if (this.ctx.storage.persistent) return this.ctx.storage.findRunByRequestId(sessionId, requestId)
    return [...this.volatileRuns.values()].find((run) => run.sessionId === sessionId && run.requestId === requestId)
  }

  private async transition(runId: string, state: RunState, error?: string) {
    const record = await this.readRun(runId)
    if (!record) return
    record.state = state
    record.updatedAt = new Date().toISOString()
    if (error !== undefined) record.error = error
    await this.saveRun(record)
  }

  private async finish(runId: string, result: LoopTurnResult) {
    const record = await this.readRun(runId)
    if (!record) return
    record.state = result.status === 'waiting_user' || result.status === 'waiting_approval' ? 'waiting' : 'completed'
    record.result = result as unknown as Record<string, unknown>
    record.updatedAt = new Date().toISOString()
    await this.saveRun(record)
  }

  getRun(runId: string) { return this.readRun(runId) }

  async listRuns(sessionId: string) {
    if (this.ctx.storage.persistent) return this.ctx.storage.listRuns(sessionId)
    return [...this.volatileRuns.values()].filter((run) => run.sessionId === sessionId)
  }

  async cancelRun(runId: string) {
    const entry = this.entries.get(runId)
    if (!entry) return false
    entry.controller.abort(new RunCancelledError())
    return true
  }

  async drain(deadlineMs = DEFAULT_DRAIN_DEADLINE_MS) {
    this.draining = true
    const deadline = Date.now() + Math.max(deadlineMs, 0)
    while (this.entries.size && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    for (const entry of this.entries.values()) entry.controller.abort(new RunCancelledError('shutdown'))
    // Do not mark non-cooperative work as stopped. On process restart the
    // durable `running` record is recoverable as interrupted.
  }
}

export const inject = ['llm', 'storage', 'tools', 'loop', 'skills']

export const apply = async (ctx: Context) => { await ctx.plugin(AgentRunner) }
