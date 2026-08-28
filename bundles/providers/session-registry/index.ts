import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import '../../../seams/storage.ts'
import { type LlmMessage } from '../../../seams/llm.ts'
import { Session } from '../../../seams/loop.ts'
import { type CreateSessionOptions, SessionRegistryService } from '../../../seams/sessions.ts'
import { StorageService, type SessionRecord, type StoredEvent } from '../../../seams/storage.ts'

const DEFAULT_TTL_MS = 30 * 60_000
const DEFAULT_SWEEP_INTERVAL_MS = 60_000
const PERSIST_DEBOUNCE_MS = 30_000

export namespace SessionRegistry { export interface Config { ttlMs?: number; sweepIntervalMs?: number } }
interface Entry { session: Session; createdAt: number; lastActiveAt: number; lastPersistedAt: number }

function replay(events: StoredEvent[], maximum: number): LlmMessage[] {
  let messages: LlmMessage[] = []
  for (const event of events) {
    if (event.type === 'context_compacted' && Array.isArray(event.history)) {
      messages = event.history.flatMap((item): LlmMessage[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const value = item as Record<string, unknown>
        if (!['user', 'assistant', 'tool'].includes(String(value.role))) return []
        return [{ role: value.role as LlmMessage['role'], content: String(value.content ?? '') }]
      })
      continue
    }
    if (event.type === 'user_message') messages.push({ role: 'user', content: String(event.content ?? '') })
    if (event.type === 'model_message') {
      const call = event.toolCall as { name?: string; args?: unknown } | undefined
      const prefix = call?.name ? `[tool_call:${call.name}(${JSON.stringify(call.args ?? {})})] ` : ''
      messages.push({ role: 'assistant', content: prefix + String(event.content ?? '') })
    }
    if (event.type === 'tool_result') messages.push({ role: 'tool', content: `[${String(event.name ?? '')}] ${JSON.stringify(event.result ?? null)}` })
  }
  return messages.slice(-maximum)
}

export class SessionRegistry extends SessionRegistryService {
  private entries = new Map<string, Entry>()
  private ttlMs: number
  private durableStorage?: StorageService

  constructor(ctx: Context, public config: SessionRegistry.Config = {}) {
    super(ctx); this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS
  }

  async [Service.init]() {
    const connect = async (storage: StorageService | undefined) => {
      if (!storage?.persistent) { this.durableStorage = undefined; return }
      if (this.durableStorage === storage) return
      this.durableStorage = storage
      await this.restore(storage)
      for (const entry of this.entries.values()) this.persist(entry)
    }
    await connect(this.ctx.reflect.get('storage', false) as StorageService | undefined)
    const disposeStorageWatch = this.ctx.on('internal/service', (name, value) => {
      if (name === 'storage') {
        void connect(value as StorageService | undefined).catch((error) => {
          if (this.durableStorage) this.ctx.logger('session-registry').warn('session restore failed: %s', String(error))
        })
      }
    })
    const interval = setInterval(() => this.sweepExpired(Date.now()), this.config.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS)
    return () => {
      clearInterval(interval)
      disposeStorageWatch()
      this.durableStorage = undefined
      for (const id of this.entries.keys()) this.ctx.emit('session/disposed', { id, reason: 'provider_disposed' })
      this.entries.clear()
    }
  }

  private async restore(storage: StorageService) {
    for (const record of await storage.loadSessions()) {
      if (this.entries.has(record.id)) continue
      const session = new Session(record.id, record.maxSteps, record.systemPrompt, record.driver, record.maxHistoryMessages, record.ownerId, record.projectId)
      if (record.driver !== 'rlm') {
        try {
          session.history.push(...replay(await storage.readEvents(record.id), record.maxHistoryMessages))
        } catch (error) {
          if (this.durableStorage === storage) throw error
          return
        }
      }
      const createdAt = Date.parse(record.createdAt)
      const lastActiveAt = Date.parse(record.lastActiveAt)
      this.entries.set(record.id, {
        session,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        lastActiveAt: Number.isFinite(lastActiveAt) ? lastActiveAt : Date.now(),
        lastPersistedAt: Number.isFinite(lastActiveAt) ? lastActiveAt : Date.now(),
      })
    }
  }

  create(options: CreateSessionOptions = {}) {
    const id = options.id ?? randomUUID()
    if (this.entries.has(id)) throw new Error(`session "${id}" already exists`)
    // "?? 8" trước đây ĐÈ LÊN default 25 của chính class Session (seams/loop.ts)
    // -- truyền literal 8 vào constructor bất cứ khi nào options.maxSteps không
    // set, nên default thật của toàn hệ thống luôn là 8 dù constructor nói 25.
    // Xác nhận thật qua REST live sau khi deploy fix maxSteps: POST /sessions
    // rỗng vẫn trả về maxSteps:8. Không hard-code lại giá trị default ở đây
    // nữa -- để `undefined` truyền thẳng, đúng 1 nguồn sự thật duy nhất.
    const session = new Session(id, options.maxSteps, options.systemPrompt, options.driver ?? 'default', options.maxHistoryMessages, options.ownerId, options.projectId)
    const now = Date.now()
    const entry = { session, createdAt: now, lastActiveAt: now, lastPersistedAt: now }
    this.entries.set(id, entry)
    this.persist(entry)
    this.ctx.emit('session/created', session)
    return session
  }

  get(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    entry.lastActiveAt = Date.now()
    if (entry.lastActiveAt - entry.lastPersistedAt >= PERSIST_DEBOUNCE_MS) {
      entry.lastPersistedAt = entry.lastActiveAt
      this.persist(entry)
    }
    return entry.session
  }
  list() { return [...this.entries.values()].map((entry) => entry.session) }
  remove(id: string) {
    const removed = this.entries.delete(id)
    if (removed) {
      if (this.durableStorage) void this.durableStorage.deleteSession(id).catch(() => undefined)
      this.ctx.emit('session/disposed', { id, reason: 'removed' })
    }
    return removed
  }

  sweepExpired(now: number) {
    for (const [id, entry] of this.entries) if (now - entry.lastActiveAt > this.ttlMs) {
      this.entries.delete(id)
      if (this.durableStorage) void this.durableStorage.deleteSession(id).catch(() => undefined)
      this.ctx.emit('session/disposed', { id, reason: 'expired' })
    }
  }

  private persist(entry: Entry) {
    const storage = this.durableStorage
    if (!storage) return
    const session = entry.session
    const record: SessionRecord = {
      id: session.id, driver: session.driver, maxSteps: session.maxSteps,
      systemPrompt: session.history[0]?.role === 'system' ? session.history[0].content : undefined,
      maxHistoryMessages: session.maxHistoryMessages, status: 'active',
      ownerId: session.ownerId,
      projectId: session.projectId,
      createdAt: new Date(entry.createdAt).toISOString(), lastActiveAt: new Date(entry.lastActiveAt).toISOString(),
    }
    void storage.saveSession(record).catch((error) => this.ctx.logger('session-registry').warn('failed to persist session: %s', String(error)))
  }
}

export const apply = async (ctx: Context, config: SessionRegistry.Config = {}) => { await ctx.plugin(SessionRegistry, config) }
