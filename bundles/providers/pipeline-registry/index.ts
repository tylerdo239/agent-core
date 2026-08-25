import { Context } from '@deepseek-ai/cordis'
import { type PipelineDefinition, PipelineRegistryService, type PipelineStage } from '../../../seams/pipeline.ts'

export class PipelineRegistry extends PipelineRegistryService {
  private definitions = new Map<string, PipelineDefinition>()
  private stages = new Map<string, PipelineStage>()

  registerPipeline(definition: PipelineDefinition) {
    if (!definition.stages.length) throw new Error(`pipeline "${definition.name}" has no stages`)
    if (this.definitions.has(definition.name)) throw new Error(`pipeline "${definition.name}" already registered`)
    const roles = new Set<string>()
    for (const binding of definition.stages) {
      if (roles.has(binding.role)) throw new Error(`pipeline "${definition.name}" binds role "${binding.role}" twice`)
      roles.add(binding.role)
    }
    this.ctx.effect(() => {
      this.definitions.set(definition.name, definition)
      return () => this.definitions.delete(definition.name)
    }, `pipelines.registerPipeline(${JSON.stringify(definition.name)})`)
  }

  registerStage(stage: PipelineStage) {
    const key = `${stage.kind}:${stage.name}`
    if (this.stages.has(key)) throw new Error(`stage "${key}" already registered`)
    this.ctx.effect(() => {
      this.stages.set(key, stage)
      return () => this.stages.delete(key)
    }, `pipelines.registerStage(${JSON.stringify(key)})`)
  }

  getPipeline(name: string) { return this.definitions.get(name) }
  getStage(name: string) { return this.stages.get(name) }
  listPipelines() { return [...this.definitions.values()] }
  listStages() { return [...this.stages.values()] }
}

export const apply = async (ctx: Context) => { await ctx.plugin(PipelineRegistry) }
