import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as projectRegistry from '../bundles/providers/project-registry/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as workspaceLocal from '../bundles/providers/workspace-local/index.ts'

const temporary: string[] = []
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }) })

async function boot(base: string, database = ':memory:') {
  const root = new Context()
  await root.plugin(stateSqlite, { path: database })
  await root.plugin(projectRegistry)
  await root.plugin(sessionRegistry)
  await root.plugin(workspaceLocal, { basePath: base })
  return root
}

describe('project workspace isolation', () => {
  it('shares sources between chats in one project but never with another project', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'agent-core-project-workspace-'))
    temporary.push(base)
    const root = await boot(base)
    try {
      const a = root.projects.create({ id: 'project-a', name: 'A', ownerId: 'alice' })
      const b = root.projects.create({ id: 'project-b', name: 'B', ownerId: 'alice' })
      const a1 = root.sessions.create({ id: 'chat-a1', driver: 'rlm', ownerId: 'alice', projectId: a.id })
      const a2 = root.sessions.create({ id: 'chat-a2', driver: 'rlm', ownerId: 'alice', projectId: a.id })
      const b1 = root.sessions.create({ id: 'chat-b1', driver: 'rlm', ownerId: 'alice', projectId: b.id })

      expect(a1.workspaceId).toBe(a2.workspaceId)
      expect(a1.workspaceId).not.toBe(b1.workspaceId)
      await root.workspace.writeFile(a1.workspaceId, 'sales.csv', Buffer.from('amount\n42\n'))

      expect((await root.workspace.listSourceFiles(a2.workspaceId)).map((file) => file.path)).toContain('sources/sales.csv')
      expect((await root.workspace.listSourceFiles(b1.workspaceId)).map((file) => file.path)).not.toContain('sources/sales.csv')
      await expect(root.workspace.readFile(b1.workspaceId, '../project-a/sales.csv')).rejects.toThrow(/escapes workspace/)
      expect(root.workspace.root(a1.workspaceId)).toContain(`${path.sep}projects${path.sep}project-a`)
    } finally { await root.fiber.dispose() }
  })

  it('keeps draft outputs per conversation and only shares explicitly promoted files', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'agent-core-project-output-'))
    temporary.push(base)
    const root = await boot(base)
    try {
      root.projects.create({ id: 'project-a', name: 'A', ownerId: 'alice' })
      const first = root.sessions.create({ id: 'chat-a1', driver: 'rlm', ownerId: 'alice', projectId: 'project-a' })
      const second = root.sessions.create({ id: 'chat-a2', driver: 'rlm', ownerId: 'alice', projectId: 'project-a' })
      const generated = path.join(root.workspace.root(first.workspaceId), '.sessions', first.id, 'generated')
      mkdirSync(generated, { recursive: true })
      writeFileSync(path.join(generated, 'draft.json'), '{"score":0.9}')

      expect((await root.workspace.listSessionOutputs(first.workspaceId, first.id)).map((file) => file.path)).toEqual(['draft.json'])
      expect(await root.workspace.listSessionOutputs(second.workspaceId, second.id)).toEqual([])
      expect(await root.workspace.listProjectOutputs(first.workspaceId)).toEqual([])

      const published = await root.workspace.promoteSessionOutput(first.workspaceId, first.id, 'draft.json')
      expect(published).toMatchObject({ path: 'draft.json', createdBySession: first.id })
      expect((await root.workspace.listProjectOutputs(second.workspaceId)).map((file) => file.path)).toEqual(['draft.json'])
      expect((await root.workspace.listSessionOutputs(first.workspaceId, first.id)).map((file) => file.path)).toEqual(['draft.json'])

      expect(await root.workspace.deleteFile(first.workspaceId, `.sessions/${first.id}/generated/draft.json`)).toBe(true)
      expect(await root.workspace.listSessionOutputs(first.workspaceId, first.id)).toEqual([])
      expect(await root.workspace.deleteFile(first.workspaceId, 'outputs/draft.json')).toBe(true)
      expect(await root.workspace.listProjectOutputs(first.workspaceId)).toEqual([])
      expect(await root.workspace.deleteFile(first.workspaceId, 'outputs/draft.json')).toBe(false)
    } finally { await root.fiber.dispose() }
  })

  it('persists project ownership and session-to-project binding across restart', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'agent-core-project-persistence-'))
    temporary.push(base)
    const database = path.join(base, 'state.db')
    const first = await boot(path.join(base, 'workspaces'), database)
    first.projects.create({ id: 'project-a', name: 'Revenue', ownerId: 'alice' })
    first.sessions.create({ id: 'chat-a', driver: 'rlm', ownerId: 'alice', projectId: 'project-a' })
    await first.fiber.dispose()

    const second = await boot(path.join(base, 'workspaces'), database)
    try {
      expect(second.projects.get('project-a')).toMatchObject({ name: 'Revenue', ownerId: 'alice' })
      expect(second.sessions.get('chat-a')).toMatchObject({ projectId: 'project-a', ownerId: 'alice' })
    } finally { await second.fiber.dispose() }
  })
})
