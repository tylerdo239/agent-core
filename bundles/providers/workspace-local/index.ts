import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceDataset, WorkspaceService, WorkspaceSnapshot } from '../../../seams/workspace.ts'

export namespace WorkspaceLocal {
  export interface Config {
    basePath?: string
    maxFileBytes?: number
  }
}

const TABULAR = new Set(['.csv', '.tsv', '.xlsx', '.xls', '.parquet'])

function safeSessionId(value: string): string {
  const safe = String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '').replace(/^[.-]+|[.-]+$/g, '')
  return safe || 'default'
}

export class WorkspaceLocal extends WorkspaceService {
  private basePath: string
  private maxFileBytes: number

  constructor(ctx: Context, public config: WorkspaceLocal.Config = {}) {
    super(ctx)
    this.basePath = path.resolve(config.basePath ?? 'data/workspaces')
    this.maxFileBytes = config.maxFileBytes ?? 70 * 1024 * 1024
    mkdirSync(this.basePath, { recursive: true })
  }

  root(sessionId: string) {
    const root = path.resolve(this.basePath, safeSessionId(sessionId))
    if (root !== this.basePath && !root.startsWith(this.basePath + path.sep)) {
      throw new Error('workspace path escapes configured base')
    }
    mkdirSync(root, { recursive: true })
    return root
  }

  listDatasets(sessionId: string): WorkspaceDataset[] {
    const root = this.root(sessionId)
    const indexPath = path.join(root, 'index.json')
    if (!existsSync(indexPath)) return []
    let value: unknown
    try {
      value = JSON.parse(readFileSync(indexPath, 'utf8'))
    } catch {
      return []
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const rows = Object.entries(value as Record<string, Record<string, unknown>>)
      .filter(([, entry]) => TABULAR.has(path.extname(String(entry.filename ?? entry.path ?? '')).toLowerCase()))
      .map(([id, entry]) => ({
        id,
        filename: String(entry.filename ?? path.basename(String(entry.path ?? id))),
        path: String(entry.path ?? ''),
        metadataFile: typeof entry.metadata_file === 'string' ? entry.metadata_file : undefined,
        createdAt: typeof entry.created_at === 'string' ? entry.created_at : undefined,
      }))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    return rows.map((row, index) => ({ ...row, active: index === 0 }))
  }

  listArtifacts(sessionId: string): string[] {
    const root = this.root(sessionId)
    const generated = path.join(root, 'generated')
    if (!existsSync(generated)) return []
    const files: string[] = []
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        if (files.length >= 50) return
        const full = path.join(directory, entry)
        const stat = statSync(full)
        if (stat.isDirectory()) visit(full)
        else if (stat.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
    visit(generated)
    return files.sort()
  }

  async writeFile(sessionId: string, filename: string, content: Buffer): Promise<{ path: string; size: number; sha256: string }> {
    if (content.byteLength > this.maxFileBytes) throw new Error(`file exceeds ${this.maxFileBytes} bytes`)
    const root = this.root(sessionId)
    const safe = this.safeRelativePath(filename)
    const target = path.join(root, safe)
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('filename escapes workspace')
    mkdirSync(path.dirname(target), { recursive: true })
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, content)
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    this.registerDataset(root, safe)
    return { path: safe, size: content.byteLength, sha256: createHash('sha256').update(content).digest('hex') }
  }

  private safeRelativePath(filename: string) {
    const parts = String(filename).split('/').filter((part) => part && part !== '.')
    if (!parts.length || parts.some((part) => part === '..' || part.includes('\0'))) throw new Error('filename escapes workspace')
    const safe = parts.map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '_')).join('/')
    if (!safe) throw new Error('filename escapes workspace')
    return safe
  }

  private registerDataset(root: string, safe: string) {
    // Generated CSV reports are artifacts, not new input datasets.
    if (safe.includes('/')) return
    const ext = path.extname(safe).toLowerCase()
    if (TABULAR.has(ext)) {
      const indexPath = path.join(root, 'index.json')
      let index: Record<string, Record<string, unknown>> = {}
      try {
        const raw = readFileSync(indexPath, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) index = parsed
      } catch { /* start fresh */ }
      const id = path.parse(safe).name
      index[id] = { filename: safe, path: safe, created_at: new Date().toISOString() }
      writeFileSync(indexPath, JSON.stringify(index, null, 2))
    }
  }

  async writeFileFromStream(
    sessionId: string,
    filename: string,
    stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | Buffer>,
    options: { maxBytes?: number } = {},
  ) {
    const root = this.root(sessionId)
    const safe = this.safeRelativePath(filename)
    const target = path.join(root, safe)
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
    const maximum = options.maxBytes ?? this.maxFileBytes
    const hash = createHash('sha256')
    let size = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.byteLength
        if (size > maximum) return callback(new Error(`file exceeds ${maximum} bytes`))
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    const source = Symbol.asyncIterator in (stream as object)
      ? Readable.from(stream as AsyncIterable<Uint8Array | Buffer>)
      : Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0])
    mkdirSync(path.dirname(target), { recursive: true })
    try {
      await pipeline(source, counter, createWriteStream(temporary, { flags: 'wx' }))
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    this.registerDataset(root, safe)
    return { path: safe, size, sha256: hash.digest('hex') }
  }

  async readFile(sessionId: string, filePath: string): Promise<Buffer> {
    const root = this.root(sessionId)
    const resolved = path.resolve(root, filePath)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('path escapes workspace')
    return readFile(resolved)
  }

  async listFiles(sessionId: string): Promise<Array<{ path: string; size: number; mtime: string }>> {
    const root = this.root(sessionId)
    const out: Array<{ path: string; size: number; mtime: string }> = []
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (out.length >= 100) return
        const full = path.join(dir, entry)
        try {
          const st = statSync(full)
          if (st.isDirectory()) { if (entry !== 'rlm_logs' && entry !== '.agent_cache' && entry !== '.agent_bootstrap') visit(full) }
          else if (st.isFile() && entry !== 'index.json') {
            out.push({ path: path.relative(root, full).split(path.sep).join('/'), size: st.size, mtime: st.mtime.toISOString() })
          }
        } catch { /* skip */ }
      }
    }
    if (existsSync(root)) visit(root)
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  async inspect(sessionId: string): Promise<WorkspaceSnapshot> {
    const root = this.root(sessionId)
    const manifest = this.listDatasets(sessionId)
    const datasets: Array<Record<string, unknown>> = []
    for (const item of manifest) {
      const file = path.resolve(root, item.path)
      if (file !== root && !file.startsWith(root + path.sep) || !existsSync(file)) continue
      const raw = readFileSync(file)
      const suffix = path.extname(file).toLowerCase()
      datasets.push({
        id: item.id,
        filename: item.filename,
        format: suffix.slice(1),
        size_bytes: raw.byteLength,
        representation: suffix === '.csv' || suffix === '.tsv' ? 'text' : 'base64',
        encoding: suffix === '.csv' || suffix === '.tsv' ? 'utf-8' : 'base64',
        content: suffix === '.csv' || suffix === '.tsv' ? raw.toString('utf8') : raw.toString('base64'),
      })
    }
    const active = manifest.find((item) => item.active)
    return {
      datasets,
      activeDataset: active ? { ...active } : undefined,
      resources: {
        datasets: manifest.map((item) => ({ ...item })),
        artifacts: this.listArtifacts(sessionId),
      },
    }
  }
}

export const apply = async (ctx: Context, config: WorkspaceLocal.Config = {}) => {
  await ctx.plugin(WorkspaceLocal, config)
}
