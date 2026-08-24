import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Database from 'better-sqlite3'
import type { EventEnvelope } from '../../../seams/events.ts'
import {
  type ArtifactFilter, type ArtifactRecord, type JobRecord, type JobState,
  type ReadEventsOptions, type RunRecord, type SessionRecord,
  StorageService, type StoredEvent,
} from '../../../seams/storage.ts'

const SCHEMA_VERSION = 2
const DEFAULT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000
const MAX_PAGE_LIMIT = 1000

export namespace SqliteStorage {
  export interface Config {
    path?: string
    retentionDays?: number
    retentionSweepIntervalMs?: number
  }
}

interface EventRow {
  session_id: string
  seq: number
  type: string
  run_id: string | null
  job_id: string | null
  timestamp: string
  versions: string | null
  payload: string
}

function eventRow(row: EventRow): EventEnvelope {
  const envelope: EventEnvelope = {
    id: `${row.session_id}:${row.seq}`,
    seq: row.seq,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    type: row.type,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }
  if (row.run_id) envelope.runId = row.run_id
  if (row.job_id) envelope.jobId = row.job_id
  if (row.versions) envelope.versions = JSON.parse(row.versions)
  return envelope
}

function jobRow(row: any): JobRecord {
  return {
    id: row.id, sessionId: row.session_id ?? undefined, name: row.name,
    state: row.state, progress: row.progress, total: row.total ?? undefined,
    input: row.input ? JSON.parse(row.input) : undefined,
    output: row.output ? JSON.parse(row.output) : undefined,
    error: row.error ?? undefined, attempts: row.attempts,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function artifactRow(row: any): ArtifactRecord {
  return {
    id: row.id, sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined, jobId: row.job_id ?? undefined,
    producer: row.producer, kind: row.kind, path: row.path, size: row.size,
    mimeType: row.mime_type, sha256: row.sha256, createdAt: row.created_at,
  }
}

export class SqliteStorage extends StorageService {
  readonly persistent = true
  private db!: Database.Database

  constructor(ctx: Context, public config: SqliteStorage.Config = {}) { super(ctx) }

  [Service.init]() {
    const path = this.config.path ?? ':memory:'
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    if (path !== ':memory:') this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
    this.ctx.logger('state-sqlite').info('connected (%s), schema v%d', path, SCHEMA_VERSION)

    let interval: ReturnType<typeof setInterval> | undefined
    if (this.config.retentionDays !== undefined) {
      const prune = () => {
        const result = this.db.prepare(`DELETE FROM events WHERE created_at < unixepoch() - ?`)
          .run(this.config.retentionDays! * 86400)
        if (result.changes) this.ctx.logger('state-sqlite').info('pruned %d old event(s)', result.changes)
      }
      prune()
      interval = setInterval(prune, this.config.retentionSweepIntervalMs ?? DEFAULT_RETENTION_SWEEP_INTERVAL_MS)
    }
    return () => { if (interval) clearInterval(interval); this.db.close() }
  }

  /** Additive, transaction-safe migration from the original event-only DB. */
  private migrate() {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const hasEvents = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'`).get())
      if (!hasEvents) {
        this.db.exec(`CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
          seq INTEGER NOT NULL, type TEXT NOT NULL, run_id TEXT, job_id TEXT,
          timestamp TEXT NOT NULL, versions TEXT, payload TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()))`)
      } else {
        const columns = new Set((this.db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[]).map((c) => c.name))
        if (!columns.has('seq')) this.db.exec(`ALTER TABLE events ADD COLUMN seq INTEGER`)
        if (!columns.has('type')) this.db.exec(`ALTER TABLE events ADD COLUMN type TEXT`)
        if (!columns.has('run_id')) this.db.exec(`ALTER TABLE events ADD COLUMN run_id TEXT`)
        if (!columns.has('job_id')) this.db.exec(`ALTER TABLE events ADD COLUMN job_id TEXT`)
        if (!columns.has('timestamp')) this.db.exec(`ALTER TABLE events ADD COLUMN timestamp TEXT`)
        if (!columns.has('versions')) this.db.exec(`ALTER TABLE events ADD COLUMN versions TEXT`)
        this.db.exec(`UPDATE events SET
          seq=COALESCE(seq,(SELECT COUNT(*) FROM events e2 WHERE e2.session_id=events.session_id AND e2.id<=events.id)),
          type=COALESCE(type,json_extract(payload,'$.type'),'unknown'),
          timestamp=COALESCE(timestamp,strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'unixepoch'))`)
      }

      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id,seq);
        CREATE TABLE IF NOT EXISTS event_sequences(session_id TEXT PRIMARY KEY,last_seq INTEGER NOT NULL);
        INSERT INTO event_sequences(session_id,last_seq)
          SELECT session_id,MAX(seq) FROM events GROUP BY session_id
          ON CONFLICT(session_id) DO UPDATE SET last_seq=MAX(last_seq,excluded.last_seq);
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(
          id TEXT PRIMARY KEY,driver TEXT NOT NULL,max_steps INTEGER NOT NULL,system_prompt TEXT,
          max_history_messages INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,last_active_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(
          id TEXT PRIMARY KEY,session_id TEXT NOT NULL,request_id TEXT,driver TEXT NOT NULL,
          state TEXT NOT NULL,error TEXT,result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_request ON runs(session_id,request_id) WHERE request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
        CREATE TABLE IF NOT EXISTS jobs(
          id TEXT PRIMARY KEY,session_id TEXT,name TEXT NOT NULL,state TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,total REAL,input TEXT,output TEXT,error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id);
        CREATE TABLE IF NOT EXISTS artifacts(
          id TEXT PRIMARY KEY,session_id TEXT,run_id TEXT,job_id TEXT,producer TEXT NOT NULL,
          kind TEXT NOT NULL,path TEXT NOT NULL,size INTEGER NOT NULL,mime_type TEXT NOT NULL,
          sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
        CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);
        INSERT INTO meta(key,value) VALUES('schema_version','${SCHEMA_VERSION}')
          ON CONFLICT(key) DO UPDATE SET value=excluded.value;
      `)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async appendEvent(sessionId: string, event: StoredEvent): Promise<EventEnvelope> {
    const { type, runId, jobId, versions, ...payload } = event
    const timestamp = new Date().toISOString()
    const insert = this.db.transaction(() => {
      const sequence = this.db.prepare(`INSERT INTO event_sequences(session_id,last_seq) VALUES(?,1)
        ON CONFLICT(session_id) DO UPDATE SET last_seq=last_seq+1 RETURNING last_seq`)
        .get(sessionId) as { last_seq: number }
      this.db.prepare(`INSERT INTO events(session_id,seq,type,run_id,job_id,timestamp,versions,payload)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        sessionId, sequence.last_seq, type,
        typeof runId === 'string' ? runId : null, typeof jobId === 'string' ? jobId : null,
        timestamp, versions && typeof versions === 'object' ? JSON.stringify(versions) : null,
        JSON.stringify(payload),
      )
      return sequence.last_seq
    })
    const seq = insert()
    return {
      id: `${sessionId}:${seq}`, seq, sessionId, timestamp, type, payload,
      ...(typeof runId === 'string' ? { runId } : {}),
      ...(typeof jobId === 'string' ? { jobId } : {}),
      ...(versions && typeof versions === 'object' ? { versions: versions as Record<string, string> } : {}),
    }
  }

  /** Legacy API stays flat so existing UI/loop code does not break. */
  async readEvents(sessionId: string): Promise<StoredEvent[]> {
    const rows = this.db.prepare(`SELECT * FROM events WHERE session_id=? ORDER BY seq`).all(sessionId) as EventRow[]
    return rows.map((row) => {
      const item = eventRow(row)
      return { type: item.type, ...item.payload,
        ...(item.runId ? { runId: item.runId } : {}),
        ...(item.jobId ? { jobId: item.jobId } : {}),
        ...(item.versions ? { versions: item.versions } : {}) }
    })
  }

  async readEventPage(sessionId: string, options: ReadEventsOptions = {}) {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), MAX_PAGE_LIMIT)
    const rows = this.db.prepare(`SELECT * FROM events WHERE session_id=? AND seq>? ORDER BY seq LIMIT ?`)
      .all(sessionId, Math.max(options.afterSeq ?? 0, 0), limit) as EventRow[]
    const events = rows.map(eventRow)
    return { events, cursor: events.at(-1)?.seq ?? null }
  }

  async saveSession(record: SessionRecord) {
    this.db.prepare(`INSERT INTO sessions(id,driver,max_steps,system_prompt,max_history_messages,status,created_at,last_active_at)
      VALUES(@id,@driver,@maxSteps,@systemPrompt,@maxHistoryMessages,@status,@createdAt,@lastActiveAt)
      ON CONFLICT(id) DO UPDATE SET driver=excluded.driver,max_steps=excluded.max_steps,
      system_prompt=excluded.system_prompt,max_history_messages=excluded.max_history_messages,
      status=excluded.status,last_active_at=excluded.last_active_at`)
      .run({ ...record, systemPrompt: record.systemPrompt ?? null })
  }
  private toSession(row: any): SessionRecord {
    return { id: row.id, driver: row.driver, maxSteps: row.max_steps,
      systemPrompt: row.system_prompt ?? undefined, maxHistoryMessages: row.max_history_messages,
      status: row.status, createdAt: row.created_at, lastActiveAt: row.last_active_at }
  }
  async loadSession(id: string) { const row = this.db.prepare(`SELECT * FROM sessions WHERE id=? AND status='active'`).get(id); return row ? this.toSession(row) : undefined }
  async loadSessions() { return (this.db.prepare(`SELECT * FROM sessions WHERE status='active' ORDER BY last_active_at DESC`).all() as any[]).map((row) => this.toSession(row)) }
  async deleteSession(id: string) { this.db.prepare(`UPDATE sessions SET status='archived' WHERE id=?`).run(id) }

  async saveRun(record: RunRecord) {
    this.db.prepare(`INSERT INTO runs(id,session_id,request_id,driver,state,error,result,created_at,updated_at)
      VALUES(@id,@sessionId,@requestId,@driver,@state,@error,@resultJson,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,error=excluded.error,result=excluded.result,updated_at=excluded.updated_at`)
      .run({ ...record, requestId: record.requestId ?? null, error: record.error ?? null,
        resultJson: record.result ? JSON.stringify(record.result) : null })
  }
  private toRun(row: any): RunRecord {
    return { id: row.id, sessionId: row.session_id, requestId: row.request_id ?? undefined,
      driver: row.driver, state: row.state, error: row.error ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined, createdAt: row.created_at, updatedAt: row.updated_at }
  }
  async getRun(id: string) { const row = this.db.prepare(`SELECT * FROM runs WHERE id=?`).get(id); return row ? this.toRun(row) : undefined }
  async findRunByRequestId(sessionId: string, requestId: string) { const row = this.db.prepare(`SELECT * FROM runs WHERE session_id=? AND request_id=?`).get(sessionId,requestId); return row ? this.toRun(row) : undefined }
  async listRuns(sessionId?: string) {
    const rows = sessionId === undefined
      ? this.db.prepare(`SELECT * FROM runs ORDER BY created_at`).all()
      : this.db.prepare(`SELECT * FROM runs WHERE session_id=? ORDER BY created_at`).all(sessionId)
    return (rows as any[]).map((row) => this.toRun(row))
  }

  async saveJob(record: JobRecord) {
    this.db.prepare(`INSERT INTO jobs(id,session_id,name,state,progress,total,input,output,error,attempts,created_at,updated_at)
      VALUES(@id,@sessionId,@name,@state,@progress,@total,@inputJson,@outputJson,@error,@attempts,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,progress=excluded.progress,total=excluded.total,
      output=excluded.output,error=excluded.error,attempts=excluded.attempts,updated_at=excluded.updated_at`)
      .run({ ...record, sessionId: record.sessionId ?? null, total: record.total ?? null,
        inputJson: record.input ? JSON.stringify(record.input) : null,
        outputJson: record.output ? JSON.stringify(record.output) : null, error: record.error ?? null })
  }
  async getJob(id: string) { const row = this.db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id); return row ? jobRow(row) : undefined }
  async listJobs(filter: { sessionId?: string; state?: JobState } = {}) {
    const where: string[] = []; const params: Record<string, unknown> = {}
    if (filter.sessionId !== undefined) { where.push('session_id=@sessionId'); params.sessionId=filter.sessionId }
    if (filter.state !== undefined) { where.push('state=@state'); params.state=filter.state }
    return (this.db.prepare(`SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at`).all(params) as any[]).map(jobRow)
  }

  async putArtifact(record: ArtifactRecord) {
    this.db.prepare(`INSERT OR REPLACE INTO artifacts(id,session_id,run_id,job_id,producer,kind,path,size,mime_type,sha256,created_at)
      VALUES(@id,@sessionId,@runId,@jobId,@producer,@kind,@path,@size,@mimeType,@sha256,@createdAt)`)
      .run({ ...record, sessionId: record.sessionId ?? null, runId: record.runId ?? null, jobId: record.jobId ?? null })
  }
  async getArtifact(id: string) { const row = this.db.prepare(`SELECT * FROM artifacts WHERE id=?`).get(id); return row ? artifactRow(row) : undefined }
  async listArtifacts(filter: ArtifactFilter = {}) {
    const where: string[] = []; const params: Record<string, unknown> = {}
    for (const [field,column] of [['sessionId','session_id'],['runId','run_id'],['jobId','job_id'],['kind','kind']] as const) {
      if (filter[field] !== undefined) { where.push(`${column}=@${field}`); params[field]=filter[field] }
    }
    return (this.db.prepare(`SELECT * FROM artifacts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at`).all(params) as any[]).map(artifactRow)
  }
}

export const apply = async (ctx: Context, config: SqliteStorage.Config = {}) => {
  await ctx.plugin(SqliteStorage, config)
}
