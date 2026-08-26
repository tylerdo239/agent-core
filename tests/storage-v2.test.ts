import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import { SqliteStorage } from '../bundles/providers/state-sqlite/index.ts'

const directories: string[] = []

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
})

function temporaryDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-core-storage-'))
  directories.push(directory)
  return path.join(directory, 'state.db')
}

async function boot(databasePath: string) {
  const context = new Context()
  context.logger.exporter({ levels: { default: 4 }, export: () => {} })
  await context.plugin(SqliteStorage, { path: databasePath })
  return { context, storage: context.storage }
}

describe('sqlite storage v2', () => {
  it('adds envelopes without changing the legacy flat read API', async () => {
    const harness = await boot(':memory:')
    try {
      const first = await harness.storage.appendEvent('session-a', { type: 'message', content: 'hello' })
      const second = await harness.storage.appendEvent('session-a', { type: 'done', runId: 'run-a' })
      expect(first && first.seq).toBe(1)
      expect(second && second.seq).toBe(2)

      expect(await harness.storage.readEvents('session-a')).toEqual([
        { type: 'message', content: 'hello' },
        { type: 'done', runId: 'run-a' },
      ])
      const page = await harness.storage.readEventPage('session-a', { afterSeq: 1, limit: 10 })
      expect(page.events.map((event) => [event.seq, event.type])).toEqual([[2, 'done']])
      expect(page.events[0]?.runId).toBe('run-a')
    } finally {
      await harness.context.fiber.dispose()
    }
  })

  it('migrates an existing event-only database', async () => {
    const databasePath = temporaryDatabase()
    const legacy = new Database(databasePath)
    legacy.exec(`CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()))`)
    legacy.prepare(`INSERT INTO events(session_id,payload) VALUES(?,?)`)
      .run('old', JSON.stringify({ type: 'user_message', content: 'hi' }))
    legacy.close()

    const harness = await boot(databasePath)
    try {
      expect(await harness.storage.readEvents('old')).toEqual([
        { type: 'user_message', content: 'hi' },
      ])
      const next = await harness.storage.appendEvent('old', { type: 'model_message', content: 'hello' })
      expect(next && next.seq).toBe(2)
    } finally {
      await harness.context.fiber.dispose()
    }
  })

  it('never reuses a sequence number after old events are pruned', async () => {
    const databasePath = temporaryDatabase()
    const firstBoot = await boot(databasePath)
    await firstBoot.storage.appendEvent('session-a', { type: 'old' })
    await firstBoot.context.fiber.dispose()

    const database = new Database(databasePath)
    database.prepare(`DELETE FROM events WHERE session_id=?`).run('session-a')
    database.close()

    const secondBoot = await boot(databasePath)
    try {
      const next = await secondBoot.storage.appendEvent('session-a', { type: 'new' })
      expect(next && next.seq).toBe(2)
    } finally {
      await secondBoot.context.fiber.dispose()
    }
  })
})
