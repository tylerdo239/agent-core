// seams/storage.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/state-sqlite (Phase 2).
import { Context, Service } from '@deepseek-ai/cordis'
import type { EventEnvelope, EventPage } from './events.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: StorageService
  }
}

export interface StoredEvent {
  type: string
  [key: string]: unknown
}

export type { EventEnvelope, EventPage }

export interface ReadEventsOptions {
  afterSeq?: number
  limit?: number
}

export interface SessionRecord {
  id: string
  driver: string
  maxSteps: number
  systemPrompt?: string
  maxHistoryMessages: number
  status: 'active' | 'archived'
  createdAt: string
  lastActiveAt: string
}

export type RunState = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface RunRecord {
  id: string
  sessionId: string
  requestId?: string
  driver: string
  state: RunState
  error?: string
  result?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export interface JobRecord {
  id: string
  sessionId?: string
  name: string
  state: JobState
  progress: number
  total?: number
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  attempts: number
  createdAt: string
  updatedAt: string
}

export interface ArtifactRecord {
  id: string
  sessionId?: string
  runId?: string
  jobId?: string
  producer: string
  kind: string
  path: string
  size: number
  mimeType: string
  sha256: string
  createdAt: string
}

export interface ArtifactFilter {
  sessionId?: string
  runId?: string
  jobId?: string
  kind?: string
}

export class UnsupportedStorageCapabilityError extends Error {
  constructor(capability: string) {
    super(`storage provider does not support ${capability}`)
    this.name = 'UnsupportedStorageCapabilityError'
  }
}

export abstract class StorageService extends Service {
  /** Providers with durable session/run/job/artifact tables override this. */
  readonly persistent: boolean = false

  constructor(ctx: Context) {
    super(ctx, 'storage')
  }

  abstract appendEvent(sessionId: string, event: StoredEvent): Promise<void | EventEnvelope>
  abstract readEvents(sessionId: string): Promise<StoredEvent[]>

  /** Backward-compatible fallback for small/in-memory providers. */
  async readEventPage(sessionId: string, options: ReadEventsOptions = {}): Promise<EventPage> {
    const all = await this.readEvents(sessionId)
    const after = Math.max(options.afterSeq ?? 0, 0)
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000)
    const selected = all.slice(after, after + limit)
    const events = selected.map((event, index): EventEnvelope => {
      const { type, ...payload } = event
      const seq = after + index + 1
      return {
        id: `${sessionId}:${seq}`,
        seq,
        sessionId,
        timestamp: new Date(0).toISOString(),
        type,
        payload,
      }
    })
    return { events, cursor: events.at(-1)?.seq ?? null }
  }

  async saveSession(_record: SessionRecord): Promise<void> { throw new UnsupportedStorageCapabilityError('session persistence') }
  async loadSession(_id: string): Promise<SessionRecord | undefined> { return undefined }
  async loadSessions(): Promise<SessionRecord[]> { return [] }
  async deleteSession(_id: string): Promise<void> { throw new UnsupportedStorageCapabilityError('session persistence') }

  async saveRun(_record: RunRecord): Promise<void> { throw new UnsupportedStorageCapabilityError('run persistence') }
  async getRun(_id: string): Promise<RunRecord | undefined> { return undefined }
  async findRunByRequestId(_sessionId: string, _requestId: string): Promise<RunRecord | undefined> { return undefined }
  async listRuns(_sessionId?: string): Promise<RunRecord[]> { return [] }

  async saveJob(_record: JobRecord): Promise<void> { throw new UnsupportedStorageCapabilityError('job persistence') }
  async getJob(_id: string): Promise<JobRecord | undefined> { return undefined }
  async listJobs(_filter: { sessionId?: string; state?: JobState } = {}): Promise<JobRecord[]> { return [] }

  async putArtifact(_record: ArtifactRecord): Promise<void> { throw new UnsupportedStorageCapabilityError('artifact persistence') }
  async getArtifact(_id: string): Promise<ArtifactRecord | undefined> { return undefined }
  async listArtifacts(_filter: ArtifactFilter = {}): Promise<ArtifactRecord[]> { return [] }
}
