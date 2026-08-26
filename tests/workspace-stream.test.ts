import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceLocal } from '../bundles/providers/workspace-local/index.ts'

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function boot(maxFileBytes = 1024) {
  const basePath = mkdtempSync(path.join(tmpdir(), 'agent-core-workspace-'))
  temporary.push(basePath)
  const root = new Context()
  await root.plugin(WorkspaceLocal, { basePath, maxFileBytes })
  return root
}

describe('workspace streaming writes', () => {
  it('atomically replaces a file and preserves the old file when upload fails', async () => {
    const root = await boot(5)
    try {
      await root.workspace.writeFile('session', 'data.csv', Buffer.from('old'))
      async function* oversized() {
        yield Buffer.from('1234')
        yield Buffer.from('5678')
      }
      await expect(root.workspace.writeFileFromStream('session', 'data.csv', oversized()))
        .rejects.toThrow('file exceeds 5 bytes')
      expect((await root.workspace.readFile('session', 'data.csv')).toString()).toBe('old')
      expect((await root.workspace.listFiles('session')).map((file) => file.path)).toEqual(['data.csv'])
    } finally {
      await root.fiber.dispose()
    }
  })

  it('streams nested generated files and returns checksum metadata', async () => {
    const root = await boot()
    try {
      async function* content() { yield Buffer.from('hello'); yield Buffer.from(' world') }
      const result = await root.workspace.writeFileFromStream('session', 'generated/report.txt', content())
      expect(result).toMatchObject({ path: 'generated/report.txt', size: 11 })
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect((await root.workspace.listFiles('session')).map((file) => file.path)).toEqual(['generated/report.txt'])
      expect(root.workspace.listDatasets('session')).toEqual([])
    } finally {
      await root.fiber.dispose()
    }
  })
})
