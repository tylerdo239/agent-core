import { Context } from '@deepseek-ai/cordis'
import '../../../seams/sandbox.ts'
import { WorkspaceDataset, WorkspaceService, WorkspaceSnapshot } from '../../../seams/workspace.ts'

export namespace WorkspaceDocker {
  export interface Config {
    volumePrefix?: string
  }
}

export function dockerWorkspaceVolume(sessionId: string, prefix = 'agent-core-rlm-workspace') {
  const safe = String(sessionId || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'default'
  return `${prefix}-${safe}`
}

/**
 * Docker mode không chạm filesystem host. root() trả một locator mà
 * sandbox-docker hiểu và mount thành named volume của đúng session.
 * Dataset/artifact manifest thật được Python ContextBuilder đọc bên trong
 * container; Node không tạo nguồn sự thật thứ hai.
 */
export class WorkspaceDocker extends WorkspaceService {
  constructor(ctx: Context, public config: WorkspaceDocker.Config = {}) {
    super(ctx)
  }

  root(sessionId: string) {
    return `docker-volume://${dockerWorkspaceVolume(sessionId, this.config.volumePrefix)}`
  }

  listDatasets(_sessionId: string): WorkspaceDataset[] {
    return []
  }

  listArtifacts(_sessionId: string): string[] {
    return []
  }

  async inspect(sessionId: string): Promise<WorkspaceSnapshot> {
    const sandbox = this.ctx.get('sandbox')
    if (!sandbox) throw new Error('workspace-docker requires a sandbox provider')
    await sandbox.openSession(sessionId, { cwd: this.root(sessionId) })
    for await (const event of sandbox.request(sessionId, 'inspect_workspace', { sessionId })) {
      if (event.type !== '__result__') continue
      const resources = event.resources && typeof event.resources === 'object'
        ? event.resources as Record<string, unknown>
        : {}
      return {
        datasets: Array.isArray(event.datasets) ? event.datasets as Array<Record<string, unknown>> : [],
        activeDataset: event.active_dataset && typeof event.active_dataset === 'object'
          ? event.active_dataset as Record<string, unknown>
          : undefined,
        resources: {
          datasets: Array.isArray(resources.datasets) ? resources.datasets as Array<Record<string, unknown>> : [],
          artifacts: Array.isArray(resources.artifacts) ? resources.artifacts.map(String) : [],
        },
      }
    }
    throw new Error('workspace inspection ended without a result')
  }

  async writeFile(sessionId: string, filename: string, content: Buffer): Promise<{ path: string; size: number }> {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^[.-]+|[.-]+$/g, '') || 'upload'
    const sandbox = this.ctx.get('sandbox') as { request?: (id: string, op: string, p: Record<string, unknown>) => AsyncIterable<Record<string, unknown>>; openSession?: (id: string, o: { cwd: string }) => Promise<void> } | undefined
    if (!sandbox?.request) throw new Error('workspace-docker requires a sandbox provider')
    await sandbox.openSession!(sessionId, { cwd: this.root(sessionId) })
    for await (const event of sandbox.request(sessionId, 'write_workspace_file', { filename: safe, content: content.toString('base64') })) {
      if (event.type === '__result__') return { path: String(event.path ?? safe), size: Number(event.size ?? content.byteLength) }
      if (event.type === 'error') throw new Error(String((event as { message?: string }).message ?? 'write failed'))
    }
    throw new Error('workspace write ended without a result')
  }

  async readFile(sessionId: string, filePath: string): Promise<Buffer> {
    const sandbox = this.ctx.get('sandbox') as { request?: (id: string, op: string, p: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> } | undefined
    if (!sandbox?.request) throw new Error('workspace-docker requires a sandbox provider')
    for await (const event of sandbox.request(sessionId, 'read_workspace_file', { path: filePath })) {
      if (event.type === '__result__') {
        const b64 = String((event as { content?: string }).content ?? '')
        return Buffer.from(b64, 'base64')
      }
      if (event.type === 'error') throw new Error(String((event as { message?: string }).message ?? 'read failed'))
    }
    throw new Error('workspace read ended without a result')
  }

  async listFiles(sessionId: string): Promise<Array<{ path: string; size: number; mtime: string }>> {
    const sandbox = this.ctx.get('sandbox') as { request?: (id: string, op: string, p: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> } | undefined
    if (!sandbox?.request) return []
    for await (const event of sandbox.request(sessionId, 'list_workspace_files', {})) {
      if (event.type === '__result__') {
        const files = (event as { files?: unknown }).files
        return Array.isArray(files) ? files as Array<{ path: string; size: number; mtime: string }> : []
      }
      if (event.type === 'error') throw new Error(String((event as { message?: string }).message ?? 'list failed'))
    }
    return []
  }
}

export const apply = async (ctx: Context, config: WorkspaceDocker.Config = {}) => {
  await ctx.plugin(WorkspaceDocker, config)
}
