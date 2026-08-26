import { Context } from '@deepseek-ai/cordis'
import '../../../seams/artifacts.ts'
import '../../../seams/jobs.ts'
import '../../../seams/sandbox.ts'
import '../../../seams/workspace.ts'
import {
  type ArtifactRef, type PipelineDefinition, type PipelineRunOptions,
  PipelineRunnerService, type PipelineStageBinding, type StageContext,
} from '../../../seams/pipeline.ts'

export class PipelineRunner extends PipelineRunnerService {
  run(pipelineName: string, sessionId: string, options: PipelineRunOptions = {}) {
    const definition = this.ctx.pipelines.getPipeline(pipelineName)
    if (!definition) throw new Error(`pipeline "${pipelineName}" not found`)
    const bindings = this.resolve(definition, options)
    const workspace = this.ctx.get('workspace')
    const artifacts = this.ctx.get('artifacts')
    if (!workspace || !artifacts) throw new Error('pipeline runner requires workspace and artifact providers')

    return this.ctx.jobs.start({
      name: `pipeline:${definition.name}`,
      sessionId,
      total: bindings.length,
      input: { stages: bindings.map((binding) => binding.stage) },
      run: async (job) => {
        let chain: ArtifactRef[] = []
        for (let index = 0; index < bindings.length; index++) {
          job.checkCancelled()
          const binding = bindings[index]!
          const stage = this.ctx.pipelines.getStage(binding.stage)
          if (!stage) throw new Error(`stage "${binding.stage}" was unloaded before execution`)
          await job.emit('stage_started', { role: binding.role, stage: binding.stage, index })
          const stageContext: StageContext = {
            pipelineName: definition.name,
            sessionId,
            jobId: job.jobId,
            signal: job.signal,
            workspace,
            artifacts,
            sandbox: this.ctx.get('sandbox'),
            config: binding.config ?? {},
            checkCancelled: job.checkCancelled,
            progress: async (value, message) => {
              if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('stage progress must be between 0 and 1')
              await job.emit('stage_progress', { role: binding.role, stage: binding.stage, value, message })
            },
            emit: job.emit,
          }
          const produced = await stage.run(stageContext, [...chain])
          job.checkCancelled()
          for (const reference of produced) {
            const record = await artifacts.get(reference.id)
            if (!record || record.path !== reference.path || record.sha256 !== reference.sha256) {
              throw new Error(`stage "${binding.stage}" returned an unregistered or inconsistent artifact "${reference.id}"`)
            }
          }
          const known = new Set(chain.map((item) => item.id))
          for (const reference of produced) if (!known.has(reference.id)) { chain.push(reference); known.add(reference.id) }
          await job.progress(index + 1, `completed ${binding.role}`)
          await job.emit('stage_completed', { role: binding.role, stage: binding.stage, index, artifacts: produced })
        }
        return { artifacts: chain }
      },
    })
  }

  private resolve(definition: PipelineDefinition, options: PipelineRunOptions): PipelineStageBinding[] {
    return definition.stages.map((binding) => {
      const name = options.override?.[binding.role] ?? binding.stage
      const stage = this.ctx.pipelines.getStage(name)
      if (!stage) throw new Error(`stage "${name}" not registered`)
      if (stage.kind !== binding.role) throw new Error(`stage "${name}" cannot fill role "${binding.role}"`)
      return { ...binding, stage: name, config: { ...(binding.config ?? {}), ...(options.config?.[binding.role] ?? {}) } }
    })
  }
}

export const inject = ['pipelines', 'jobs', 'workspace', 'artifacts']
export const apply = async (ctx: Context) => { await ctx.plugin(PipelineRunner) }
