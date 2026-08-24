import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as artifactService from '../bundles/providers/artifact-service/index.ts'
import * as jobRunner from '../bundles/providers/job-runner/index.ts'
import * as pipelineRegistry from '../bundles/providers/pipeline-registry/index.ts'
import * as pipelineRunner from '../bundles/providers/pipeline-runner/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as workspaceLocal from '../bundles/providers/workspace-local/index.ts'
import type { ArtifactRef, StageContext } from '../seams/pipeline.ts'

const temporary: string[] = []
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function boot(maxConcurrent = 1) {
  const basePath = mkdtempSync(path.join(tmpdir(), 'agent-core-pipeline-'))
  temporary.push(basePath)
  const root = new Context()
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(workspaceLocal, { basePath })
  root.plugin(artifactService)
  root.plugin(jobRunner, { maxConcurrent, watchIntervalMs: 10 })
  root.plugin(pipelineRegistry)
  root.plugin(pipelineRunner)
  await settle()
  return root
}

async function waitForJob(root: Context, id: string) {
  for (let index = 0; index < 200; index++) {
    const job = await root.jobs.get(id)
    if (job && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.state)) return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('job did not finish')
}

async function artifact(context: StageContext, kind: string, filename: string, content: string): Promise<ArtifactRef> {
  const path = `generated/${context.jobId}/${filename}`
  const buffer = Buffer.from(content)
  const written = await context.workspace.writeFile(context.sessionId, path, buffer)
  const sha256 = written.sha256 ?? createHash('sha256').update(buffer).digest('hex')
  const record = await context.artifacts.register({
    sessionId: context.sessionId, jobId: context.jobId, producer: `${kind}:test`, kind,
    path, size: buffer.byteLength, mimeType: 'text/plain', sha256,
  })
  return { id: record.id, path: record.path, kind: record.kind, sha256: record.sha256 }
}

describe('jobs and modular pipelines', () => {
  it('cancels queued work without ever executing it', async () => {
    const root = await boot(1)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let secondRan = false
    try {
      const first = await root.jobs.start({ name: 'first', run: async () => { await gate } })
      const second = await root.jobs.start({ name: 'second', run: async () => { secondRan = true } })
      expect(await root.jobs.cancel(second.id)).toBe(true)
      release()
      expect((await waitForJob(root, first.id)).state).toBe('succeeded')
      expect((await waitForJob(root, second.id)).state).toBe('cancelled')
      expect(secondRan).toBe(false)
    } finally { await root.fiber.dispose() }
  })

  it('runs a multi-stage pipeline with maxConcurrent=1 and supports stage replacement', async () => {
    const root = await boot(1)
    try {
      root.pipelines.registerStage({
        kind: 'data', name: 'seed',
        run: async (context) => [await artifact(context, 'dataset', 'data.txt', 'raw')],
      })
      root.pipelines.registerStage({
        kind: 'feature', name: 'basic',
        run: async (context, input) => [await artifact(context, 'features', 'features.txt', `basic:${input.length}`)],
      })
      root.pipelines.registerStage({
        kind: 'feature', name: 'alternate',
        run: async (context, input) => [await artifact(context, 'features', 'features.txt', `alternate:${input.length}`)],
      })
      root.pipelines.registerPipeline({ name: 'demo', stages: [
        { role: 'data', stage: 'data:seed' },
        { role: 'feature', stage: 'feature:basic' },
      ] })

      const started = await root.pipelineRuns.run('demo', 'session', { override: { feature: 'feature:alternate' } })
      const finished = await waitForJob(root, started.id)
      expect(finished.state).toBe('succeeded')
      const output = finished.output?.artifacts as ArtifactRef[]
      expect(output.map((item) => item.kind)).toEqual(['dataset', 'features'])
      expect((await root.workspace.readFile('session', output[1]!.path)).toString()).toBe('alternate:1')
      expect(await root.artifacts.list({ jobId: started.id })).toHaveLength(2)
    } finally { await root.fiber.dispose() }
  })
})
