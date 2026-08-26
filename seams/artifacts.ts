import { Context, Service } from '@deepseek-ai/cordis'
import type { ArtifactFilter, ArtifactRecord } from './storage.ts'

declare module '@deepseek-ai/cordis' { interface Context { artifacts: ArtifactService } }
export type { ArtifactFilter, ArtifactRecord }

export interface ArtifactInput {
  id?: string
  sessionId?: string
  runId?: string
  jobId?: string
  producer: string
  kind: string
  path: string
  size: number
  mimeType: string
  sha256: string
}

export abstract class ArtifactService extends Service {
  constructor(ctx: Context) { super(ctx, 'artifacts') }
  abstract register(input: ArtifactInput): Promise<ArtifactRecord>
  abstract get(id: string): Promise<ArtifactRecord | undefined>
  abstract list(filter?: ArtifactFilter): Promise<ArtifactRecord[]>
}
