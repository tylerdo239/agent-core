import { Context, Service } from '@deepseek-ai/cordis'
import type { ArtifactService } from './artifacts.ts'
import type { JobRecord } from './storage.ts'
import type { SandboxService } from './sandbox.ts'
import type { WorkspaceService } from './workspace.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { pipelines: PipelineRegistryService; pipelineRuns: PipelineRunnerService }
}

export type PipelineStageKind = 'data' | 'feature' | 'train' | 'validate' | 'report'
export interface ArtifactRef { id: string; path: string; kind: string; sha256: string }

export interface StageContext {
  pipelineName: string
  sessionId: string
  jobId: string
  signal: AbortSignal
  workspace: WorkspaceService
  artifacts: ArtifactService
  sandbox?: SandboxService
  config: Record<string, unknown>
  progress(value: number, message?: string): Promise<void>
  emit(type: string, data?: Record<string, unknown>): Promise<void>
  checkCancelled(): void
}

export interface PipelineStage {
  name: string
  kind: PipelineStageKind
  description?: string
  run(context: StageContext, input: ArtifactRef[]): Promise<ArtifactRef[]>
}
export interface PipelineStageBinding { role: PipelineStageKind; stage: string; config?: Record<string, unknown> }
export interface PipelineDefinition { name: string; stages: PipelineStageBinding[] }
export interface PipelineRunOptions {
  override?: Partial<Record<PipelineStageKind, string>>
  config?: Partial<Record<PipelineStageKind, Record<string, unknown>>>
}

export abstract class PipelineRegistryService extends Service {
  constructor(ctx: Context) { super(ctx, 'pipelines') }
  abstract registerPipeline(definition: PipelineDefinition): void
  abstract registerStage(stage: PipelineStage): void
  abstract getPipeline(name: string): PipelineDefinition | undefined
  abstract getStage(fullName: string): PipelineStage | undefined
  abstract listPipelines(): PipelineDefinition[]
  abstract listStages(): PipelineStage[]
}

export abstract class PipelineRunnerService extends Service {
  constructor(ctx: Context) { super(ctx, 'pipelineRuns') }
  abstract run(pipelineName: string, sessionId: string, options?: PipelineRunOptions): Promise<JobRecord>
}
