import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceDataset, WorkspaceService, WorkspaceSnapshot } from '../../../seams/workspace.ts'

export namespace WorkspaceLocal {
  export interface Config {
    basePath?: string
  }
}

const TABULAR = new Set(['.csv', '.tsv', '.xlsx', '.xls', '.parquet'])

function safeSessionId(value: string): string {
  const safe = String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '').replace(/^[.-]+|[.-]+$/g, '')
  return safe || 'default'
}

export class WorkspaceLocal extends WorkspaceService {
  private basePath: string

  constructor(ctx: Context, public config: WorkspaceLocal.Config = {}) {
    super(ctx)
    this.basePath = path.resolve(config.basePath ?? 'data/workspaces')
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

  async writeFile(sessionId: string, filename: string, content: Buffer): Promise<{ path: string; size: number }> {
    const root = this.root(sessionId)
    const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload'
    const target = path.join(root, safe)
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('filename escapes workspace')
    await writeFile(target, content)
    // Đăng ký tabular files vào index.json để list_datasets()/load_dataset() thấy
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
    return { path: safe, size: content.byteLength }
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
