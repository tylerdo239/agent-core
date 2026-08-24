import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'

const temporary: string[] = []
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }) })

async function boot(database: string) {
  const root = new Context()
  root.plugin(stateSqlite, { path: database })
  root.plugin(sessionRegistry)
  await new Promise((resolve) => setTimeout(resolve, 20))
  return root
}

describe('session persistence', () => {
  it('restores metadata and conversational history after restart', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-core-session-'))
    temporary.push(directory)
    const database = path.join(directory, 'state.db')
    const first = await boot(database)
    const session = first.sessions.create({ id: 'persistent', driver: 'default', systemPrompt: 'system rule' })
    await first.storage.appendEvent(session.id, { type: 'user_message', content: 'hello' })
    await first.storage.appendEvent(session.id, { type: 'model_message', content: 'hi back' })
    await first.fiber.dispose()

    const second = await boot(database)
    try {
      const restored = second.sessions.get('persistent')
      expect(restored?.driver).toBe('default')
      expect(restored?.history).toEqual([
        { role: 'system', content: 'system rule' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi back' },
      ])
    } finally { await second.fiber.dispose() }
  })

  it('still works as an in-memory plugin when no storage provider is mounted', async () => {
    const root = new Context()
    root.plugin(sessionRegistry)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(root.sessions.create({ id: 'memory-only' }).id).toBe('memory-only')
    await root.fiber.dispose()
  })
})
