import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it } from 'vitest'
import * as artifactService from '../bundles/providers/artifact-service/index.ts'
import * as jobRunner from '../bundles/providers/job-runner/index.ts'
import * as pipelineRegistry from '../bundles/providers/pipeline-registry/index.ts'
import * as pipelineRunner from '../bundles/providers/pipeline-runner/index.ts'
import * as sandboxIpython from '../bundles/providers/sandbox-ipython/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as workspaceLocal from '../bundles/providers/workspace-local/index.ts'
import * as dataLoad from '../bundles/pipelines/stages/data-load/index.ts'
import * as featureBasic from '../bundles/pipelines/stages/feature-basic/index.ts'
import * as trainMajority from '../bundles/pipelines/stages/train-majority/index.ts'
import * as trainFlaml from '../bundles/pipelines/stages/train-flaml/index.ts'
import * as validateHoldout from '../bundles/pipelines/stages/validate-split/index.ts'
import * as reportMarkdown from '../bundles/pipelines/stages/report-markdown/index.ts'
import * as tabularPipeline from '../bundles/pipelines/pipeline-tabular-classification/index.ts'
import { LlmService } from '../seams/llm.ts'

const enabled = process.env.RUN_ML_E2E === '1'
const directories: string[] = []
afterAll(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }) })

class UnusedLlm extends LlmService { async complete() { return { content: '' } } }

async function terminal(root: Context, id: string) {
  for (let index = 0; index < 600; index++) {
    const job = await root.jobs.get(id)
    if (job && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.state)) return job
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('pipeline timed out')
}

describe.skipIf(!enabled)('real Python tabular pipeline', () => {
  it('runs leak-free majority and FLAML variants end to end', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'agent-core-ml-'))
    directories.push(workspace)
    const root = new Context()
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(workspaceLocal, { basePath: workspace })
    root.plugin(sessionRegistry)
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(UnusedLlm)
    root.plugin(sandboxIpython, { workerPath: '/tmp/unused-worker.py', runtimeRoot: '/tmp' })
    root.plugin(artifactService)
    root.plugin(jobRunner, { maxConcurrent: 1 })
    root.plugin(pipelineRegistry)
    root.plugin(dataLoad); root.plugin(featureBasic); root.plugin(trainMajority); root.plugin(trainFlaml)
    root.plugin(validateHoldout); root.plugin(reportMarkdown); root.plugin(tabularPipeline); root.plugin(pipelineRunner)
    await new Promise((resolve) => setTimeout(resolve, 50))

    try {
      const session = root.sessions.create({ id: 'ml-session' })
      const rows = ['x1,x2,label']
      for (let index = 0; index < 40; index++) rows.push(`${index},${index % 3},${index < 20 ? 'A' : 'B'}`)
      await root.workspace.writeFile(session.id, 'sample.csv', Buffer.from(rows.join('\n')))
      const config = {
        feature: { target: 'label', validationFraction: 0.25 },
        train: { target: 'label', timeBudgetSec: 1 },
        validate: { target: 'label' },
      }

      const majority = await root.pipelineRuns.run('tabular-classification', session.id, { config })
      const majorityDone = await terminal(root, majority.id)
      expect(majorityDone.state, majorityDone.error).toBe('succeeded')

      const flaml = await root.pipelineRuns.run('tabular-classification', session.id, {
        config, override: { train: 'train:flaml' },
      })
      const flamlDone = await terminal(root, flaml.id)
      expect(flamlDone.state, flamlDone.error).toBe('succeeded')
      expect((await root.artifacts.list({ jobId: flaml.id })).some((artifact) => artifact.kind === 'report')).toBe(true)
    } finally { await root.fiber.dispose() }
  }, 120_000)
})
