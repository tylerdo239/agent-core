import { Context, Service } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspace: WorkspaceService
  }
}

export interface WorkspaceDataset {
  id: string
  filename: string
  path: string
  metadataFile?: string
  createdAt?: string
  active?: boolean
}

export interface WorkspaceFile {
  path: string
  size: number
  mtime: string
}

export interface PromotedWorkspaceOutput extends WorkspaceFile {
  sourcePath: string
  createdBySession: string
}

/** Dữ liệu workspace đã được đọc một lần ở đầu turn để dựng RLM context. */
export interface WorkspaceSnapshot {
  /** Chỉ context đầu tiên cần nội dung đầy đủ; các turn sau dùng manifest trong memory. */
  datasets: Array<Record<string, unknown>>
  activeDataset?: Record<string, unknown>
  resources: {
    datasets: Array<Record<string, unknown>>
    artifacts: string[]
  }
}

/** Canonical per-session filesystem layout used by data-agent loops and adapters. */
export abstract class WorkspaceService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workspace')
  }

  abstract root(sessionId: string): string
  abstract listDatasets(sessionId: string): WorkspaceDataset[]
  abstract listArtifacts(sessionId: string): string[]
  /**
   * Snapshot canonical dùng để chuẩn bị một turn. Provider local đọc host FS;
   * provider Docker đọc named volume qua sandbox worker. Consumer không cần
   * biết workspace đang nằm ở đâu.
   */
  abstract inspect(sessionId: string, runtimeSessionId?: string): Promise<WorkspaceSnapshot>

  /** Lưu file do user upload vào workspace. Tabular files được đăng ký vào index.json. */
  abstract writeFile(sessionId: string, filename: string, content: Buffer): Promise<{ path: string; size: number; sha256?: string }>

  /** Providers may override this to avoid buffering (workspace-local does). */
  async writeFileFromStream(
    sessionId: string,
    filename: string,
    stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | Buffer>,
    options: { maxBytes?: number } = {},
  ): Promise<{ path: string; size: number; sha256: string }> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream as AsyncIterable<Uint8Array | Buffer>) {
      const buffer = Buffer.from(chunk)
      size += buffer.byteLength
      if (options.maxBytes !== undefined && size > options.maxBytes) throw new Error(`file exceeds ${options.maxBytes} bytes`)
      chunks.push(buffer)
    }
    const content = Buffer.concat(chunks)
    const written = await this.writeFile(sessionId, filename, content)
    return { ...written, sha256: written.sha256 ?? createHash('sha256').update(content).digest('hex') }
  }

  /** Đọc nội dung file trong workspace (kể cả generated artifacts). */
  abstract readFile(sessionId: string, filePath: string): Promise<Buffer>

  /** Liệt kê mọi file trong workspace (datasets + artifacts + file thường). */
  abstract listFiles(sessionId: string): Promise<WorkspaceFile[]>

  /** User-provided project inputs. Outputs and internal session state are excluded. */
  abstract listSourceFiles(workspaceId: string): Promise<WorkspaceFile[]>

  /** Draft artifacts created by one conversation only. Paths are relative to its generated directory. */
  abstract listSessionOutputs(workspaceId: string, runtimeSessionId: string): Promise<WorkspaceFile[]>

  /** Outputs explicitly published for reuse across the project. */
  abstract listProjectOutputs(workspaceId: string): Promise<WorkspaceFile[]>

  /** Copy a session draft into the shared project output area without overwriting an existing file. */
  abstract promoteSessionOutput(
    workspaceId: string,
    runtimeSessionId: string,
    sourcePath: string,
    outputName?: string,
  ): Promise<PromotedWorkspaceOutput>
}
