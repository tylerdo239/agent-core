// bundles/state-sqlite — provider cho seam ctx.storage (Phase 2, temporal composability).
//
// LƯU Ý so với pseudocode trong build plan gốc: `Service` KHÔNG có
// `start()`/`stop()` built-in. Lifecycle thật của Cordis v4: khi 1 class kế
// thừa Service được dùng trực tiếp làm plugin (`ctx.plugin(SqliteStorage)`),
// Cordis gọi `new SqliteStorage(ctx, config)` rồi gọi `instance[Service.init]()`
// nếu có — giá trị trả về (1 hàm dispose) được đăng ký làm effect của đúng
// fiber sở hữu plugin này. Đây chính là chỗ "temporal composability áp dụng"
// mà plan gốc nói tới, chỉ khác tên API.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Database from 'better-sqlite3'
import { StorageService, StoredEvent } from '../../../seams/storage.ts'

const DEFAULT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000

export namespace SqliteStorage {
  export interface Config {
    path?: string
    /**
     * Phase 8.4 (coding rule A14): số ngày giữ event trước khi bị prune.
     * KHÔNG set = không prune gì — giữ đúng hành vi trước đây (backward
     * compatible), không âm thầm xoá dữ liệu của ai chưa yêu cầu retention.
     */
    retentionDays?: number
    /** Chu kỳ chạy sweep prune, chỉ có tác dụng khi retentionDays được set. Default 1 giờ. */
    retentionSweepIntervalMs?: number
  }
}

export class SqliteStorage extends StorageService {
  private db!: Database.Database

  constructor(ctx: Context, public config: SqliteStorage.Config = {}) {
    super(ctx)
  }

  [Service.init]() {
    const path = this.config.path ?? ':memory:'
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    // WAL: reader (readEvents) không bị chặn bởi writer (appendEvent) đang
    // ghi dở — mặc định rollback-journal của better-sqlite3 khoá cả DB lúc
    // ghi. `:memory:` không hỗ trợ WAL (không có file để ghi -wal/-shm cạnh
    // nó) — bỏ qua, giữ đúng hành vi mặc định của SQLite in-memory.
    if (path !== ':memory:') this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)
    // Gap thật phát hiện lúc audit (2026-08-20): readEvents() lọc theo
    // session_id không có index -> full table scan, chấp nhận được ở quy mô
    // nhỏ nhưng chậm dần khi event tích luỹ qua nhiều session. IF NOT EXISTS
    // để tương thích ngược với DB file cũ đã tồn tại trước bản sửa này.
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_events_session_id ON events (session_id)`)
    this.ctx.logger('state-sqlite').info('connected (%s)', path)

    let sweepInterval: ReturnType<typeof setInterval> | undefined
    if (this.config.retentionDays !== undefined) {
      const retentionDays = this.config.retentionDays
      const sweepIntervalMs = this.config.retentionSweepIntervalMs ?? DEFAULT_RETENTION_SWEEP_INTERVAL_MS
      const prune = () => {
        const result = this.db
          .prepare(`DELETE FROM events WHERE created_at < unixepoch() - ?`)
          .run(retentionDays * 86400)
        if (result.changes > 0) {
          this.ctx.logger('state-sqlite').info('retention sweep: pruned %d event(s) older than %d day(s)', result.changes, retentionDays)
        }
      }
      prune()
      sweepInterval = setInterval(prune, sweepIntervalMs)
    }

    return () => {
      if (sweepInterval) clearInterval(sweepInterval)
      this.db.close()
      this.ctx.logger('state-sqlite').info('closed cleanly')
    }
  }

  async appendEvent(sessionId: string, event: StoredEvent) {
    this.db
      .prepare(`INSERT INTO events (session_id, payload) VALUES (?, ?)`)
      .run(sessionId, JSON.stringify(event))
  }

  async readEvents(sessionId: string) {
    const rows = this.db
      .prepare(`SELECT payload FROM events WHERE session_id = ? ORDER BY id ASC`)
      .all(sessionId) as { payload: string }[]
    return rows.map((row) => JSON.parse(row.payload) as StoredEvent)
  }
}

export const apply = async (ctx: Context, config: SqliteStorage.Config = {}) => {
  await ctx.plugin(SqliteStorage, config)
}
