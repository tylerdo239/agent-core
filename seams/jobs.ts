import { Context, Service } from '@deepseek-ai/cordis'
import type { EventEnvelope } from './events.ts'
import type { JobRecord, JobState } from './storage.ts'

declare module '@deepseek-ai/cordis' { interface Context { jobs: JobService } }
export type { JobRecord, JobState }

export class JobCancelledError extends Error {
  constructor(message = 'job cancelled') { super(message); this.name = 'JobCancelledError' }
}

export interface JobRunContext {
  jobId: string
  signal: AbortSignal
  progress(value: number, message?: string): Promise<void>
  emit(type: string, data?: Record<string, unknown>): Promise<void>
  checkCancelled(): void
}

export interface JobDefinition {
  name: string
  sessionId?: string
  input?: Record<string, unknown>
  total?: number
  run(context: JobRunContext): Promise<Record<string, unknown> | void>
}

export abstract class JobService extends Service {
  constructor(ctx: Context) { super(ctx, 'jobs') }
  abstract start(definition: JobDefinition): Promise<JobRecord>
  abstract get(jobId: string): Promise<JobRecord | undefined>
  abstract list(filter?: { sessionId?: string; state?: JobState }): Promise<JobRecord[]>
  abstract cancel(jobId: string): Promise<boolean>
  abstract retry(jobId: string): Promise<JobRecord | undefined>
  abstract watch(jobId: string, cursor?: number): AsyncIterable<EventEnvelope>
}
