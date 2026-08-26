import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import '../../../seams/storage.ts'
import { type JobDefinition, JobCancelledError, type JobRunContext, JobService } from '../../../seams/jobs.ts'
import type { EventEnvelope } from '../../../seams/events.ts'
import type { JobRecord } from '../../../seams/storage.ts'

const TERMINAL: JobRecord['state'][] = ['succeeded', 'failed', 'cancelled', 'interrupted']

export namespace JobRunner {
  export interface Config { maxConcurrent?: number; watchIntervalMs?: number }
}

interface Pending { record: JobRecord; definition: JobDefinition }
interface Live extends Pending { controller: AbortController }

export class JobRunner extends JobService {
  private waiting: Pending[] = []
  private live = new Map<string, Live>()
  private definitions = new Map<string, JobDefinition>()
  private pumping = false
  private maxConcurrent: number
  private watchIntervalMs: number

  constructor(ctx: Context, public config: JobRunner.Config = {}) {
    super(ctx)
    this.maxConcurrent = Math.max(config.maxConcurrent ?? 4, 1)
    this.watchIntervalMs = Math.max(config.watchIntervalMs ?? 100, 10)
  }

  async [Service.init]() {
    if (!this.ctx.storage.persistent) throw new Error('job-runner requires persistent storage')
    for (const state of ['queued', 'running'] as const) {
      for (const record of await this.ctx.storage.listJobs({ state })) {
        await this.update(record, 'interrupted', 'service restarted before job completed')
      }
    }
    return () => { for (const job of this.live.values()) job.controller.abort(new JobCancelledError('shutdown')) }
  }

  private sessionKey(record: JobRecord) { return record.sessionId ?? `job:${record.id}` }
  private async event(record: JobRecord, type: string, data: Record<string, unknown> = {}) {
    await this.ctx.storage.appendEvent(this.sessionKey(record), {
      type, jobId: record.id, name: record.name, state: record.state, progress: record.progress, ...data,
    })
  }

  async start(definition: JobDefinition) {
    if (!definition.name || typeof definition.run !== 'function') throw new Error('job definition requires name and run()')
    if (definition.total !== undefined && (!Number.isFinite(definition.total) || definition.total <= 0)) {
      throw new Error('job total must be a positive finite number')
    }
    const now = new Date().toISOString()
    const record: JobRecord = {
      id: randomUUID(), sessionId: definition.sessionId, name: definition.name,
      state: 'queued', progress: 0, total: definition.total, input: definition.input,
      attempts: 0, createdAt: now, updatedAt: now,
    }
    await this.ctx.storage.saveJob(record)
    await this.event(record, 'job_queued')
    this.definitions.set(record.id, definition)
    this.waiting.push({ record, definition })
    void this.pump()
    return record
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.waiting.length && this.live.size < this.maxConcurrent) {
        const next = this.waiting.shift()!
        const record = await this.ctx.storage.getJob(next.record.id)
        if (!record || record.state !== 'queued') continue
        record.state = 'running'; record.attempts += 1; record.updatedAt = new Date().toISOString()
        await this.ctx.storage.saveJob(record); await this.event(record, 'job_started')
        const live: Live = { record, definition: next.definition, controller: new AbortController() }
        this.live.set(record.id, live)
        void this.execute(live).finally(() => { this.live.delete(record.id); void this.pump() })
      }
    } finally { this.pumping = false }
  }

  private context(live: Live): JobRunContext {
    return {
      jobId: live.record.id,
      signal: live.controller.signal,
      checkCancelled: () => { if (live.controller.signal.aborted) throw new JobCancelledError() },
      progress: async (value, message) => {
        if (!Number.isFinite(value) || value < live.record.progress) throw new Error('job progress must be finite and monotonic')
        if (live.record.total !== undefined && value > live.record.total) throw new Error('job progress exceeds total')
        const current = await this.ctx.storage.getJob(live.record.id)
        if (!current || TERMINAL.includes(current.state)) return
        current.progress = value; current.updatedAt = new Date().toISOString()
        if (message !== undefined) current.output = { ...(current.output ?? {}), message }
        live.record = current
        await this.ctx.storage.saveJob(current); await this.event(current, 'job_progress', message ? { message } : {})
      },
      emit: async (type, data = {}) => { await this.event(live.record, `job_event:${type}`, data) },
    }
  }

  private async execute(live: Live) {
    try {
      const output = await live.definition.run(this.context(live))
      const current = await this.ctx.storage.getJob(live.record.id)
      if (!current || TERMINAL.includes(current.state)) return
      if (live.controller.signal.aborted) throw new JobCancelledError()
      current.state = 'succeeded'; current.updatedAt = new Date().toISOString()
      if (current.total !== undefined) current.progress = current.total
      if (output) current.output = { ...(current.output ?? {}), ...output }
      await this.ctx.storage.saveJob(current); await this.event(current, 'job_succeeded')
    } catch (error) {
      const current = await this.ctx.storage.getJob(live.record.id)
      if (!current || TERMINAL.includes(current.state)) return
      current.state = live.controller.signal.aborted || error instanceof JobCancelledError ? 'cancelled' : 'failed'
      current.error = error instanceof Error ? error.message : String(error)
      current.updatedAt = new Date().toISOString()
      await this.ctx.storage.saveJob(current)
      await this.event(current, current.state === 'cancelled' ? 'job_cancelled' : 'job_failed', { error: current.error })
    }
  }

  get(id: string) { return this.ctx.storage.getJob(id) }
  list(filter = {}) { return this.ctx.storage.listJobs(filter) }

  async cancel(id: string) {
    const current = await this.ctx.storage.getJob(id)
    if (!current || TERMINAL.includes(current.state)) return false
    const live = this.live.get(id)
    if (live) { live.controller.abort(new JobCancelledError()); return true }
    if (current.state === 'queued') {
      await this.update(current, 'cancelled', 'cancelled while queued')
      await this.event(current, 'job_cancelled')
      return true
    }
    return false
  }

  async retry(id: string) {
    const current = await this.ctx.storage.getJob(id)
    const definition = this.definitions.get(id)
    // After restart the executor function is gone. Never create a queued job
    // that no worker can actually execute.
    if (!current || !definition || !['failed', 'cancelled', 'interrupted'].includes(current.state)) return undefined
    current.state = 'queued'; current.progress = 0; current.error = undefined; current.updatedAt = new Date().toISOString()
    await this.ctx.storage.saveJob(current); await this.event(current, 'job_requeued')
    this.waiting.push({ record: current, definition }); void this.pump()
    return current
  }

  async *watch(id: string, cursor = 0): AsyncIterable<EventEnvelope> {
    const initial = await this.ctx.storage.getJob(id)
    if (!initial) return
    const key = this.sessionKey(initial)
    let afterSeq = cursor
    while (true) {
      const page = await this.ctx.storage.readEventPage(key, { afterSeq, limit: 100 })
      for (const event of page.events) {
        afterSeq = event.seq
        if (event.jobId === id) yield event
      }
      const current = await this.ctx.storage.getJob(id)
      if (!current || TERMINAL.includes(current.state)) {
        const tail = await this.ctx.storage.readEventPage(key, { afterSeq, limit: 100 })
        for (const event of tail.events) if (event.jobId === id) yield event
        return
      }
      await new Promise((resolve) => setTimeout(resolve, this.watchIntervalMs))
    }
  }

  private async update(record: JobRecord, state: JobRecord['state'], error?: string) {
    record.state = state; record.error = error; record.updatedAt = new Date().toISOString()
    await this.ctx.storage.saveJob(record)
  }
}

export const inject = ['storage']
export const apply = async (ctx: Context, config: JobRunner.Config = {}) => { await ctx.plugin(JobRunner, config) }
