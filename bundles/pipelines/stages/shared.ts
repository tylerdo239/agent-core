import { createHash } from 'node:crypto'
import type { ArtifactRef, StageContext } from '../../../seams/pipeline.ts'

export async function registerWorkspaceArtifact(context: StageContext, options: {
  path: string; kind: string; producer: string; mimeType: string
}): Promise<ArtifactRef> {
  const content = await context.workspace.readFile(context.sessionId, options.path)
  const sha256 = createHash('sha256').update(content).digest('hex')
  const record = await context.artifacts.register({
    sessionId: context.sessionId, jobId: context.jobId,
    producer: options.producer, kind: options.kind, path: options.path,
    size: content.byteLength, mimeType: options.mimeType, sha256,
  })
  return { id: record.id, path: record.path, kind: record.kind, sha256: record.sha256 }
}

export function byKind(input: ArtifactRef[], kind: string) { return input.find((artifact) => artifact.kind === kind) }
export function outputPath(context: StageContext, filename: string) { return `generated/${context.jobId}/${filename}` }
export function localRoot(context: StageContext) {
  const root = context.workspace.root(context.sessionId)
  if (root.startsWith('docker-volume://')) throw new Error('pipeline stages currently require workspace-local; docker-volume execution is not implemented')
  return root
}
