import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { type CreateProjectOptions, type Project, ProjectRegistryService } from '../../../seams/projects.ts'
import { StorageService, type ProjectRecord } from '../../../seams/storage.ts'

export class ProjectRegistry extends ProjectRegistryService {
  private entries = new Map<string, Project>()
  private durableStorage?: StorageService

  constructor(ctx: Context) { super(ctx) }

  async [Service.init]() {
    const connect = async (storage: StorageService | undefined) => {
      if (!storage?.persistent) { this.durableStorage = undefined; return }
      if (this.durableStorage === storage) return
      this.durableStorage = storage
      for (const record of await storage.loadProjects()) {
        if (!this.entries.has(record.id)) this.entries.set(record.id, this.fromRecord(record))
      }
      for (const project of this.entries.values()) this.persist(project)
    }
    await connect(this.ctx.reflect.get('storage', false) as StorageService | undefined)
    const dispose = this.ctx.on('internal/service', (name, value) => {
      if (name === 'storage') void connect(value as StorageService | undefined)
    })
    return () => { dispose(); this.durableStorage = undefined; this.entries.clear() }
  }

  create(options: CreateProjectOptions): Project {
    const name = options.name.trim()
    if (!name) throw new Error('project name is required')
    const id = options.id ?? randomUUID()
    if (this.entries.has(id)) throw new Error(`project "${id}" already exists`)
    const now = Date.now()
    const project = { id, name: name.slice(0, 120), ownerId: options.ownerId, createdAt: now, updatedAt: now }
    this.entries.set(id, project)
    this.persist(project)
    return project
  }

  get(id: string) { return this.entries.get(id) }
  list() { return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt) }
  rename(id: string, rawName: string) {
    const project = this.entries.get(id)
    const name = rawName.trim()
    if (!project || !name) return undefined
    project.name = name.slice(0, 120)
    project.updatedAt = Date.now()
    this.persist(project)
    return project
  }
  touch(id: string) {
    const project = this.entries.get(id)
    if (!project) return undefined
    project.updatedAt = Date.now()
    this.persist(project)
    return project
  }
  remove(id: string) {
    const removed = this.entries.delete(id)
    if (removed && this.durableStorage) void this.durableStorage.deleteProject(id).catch(() => undefined)
    return removed
  }

  private fromRecord(record: ProjectRecord): Project {
    return {
      id: record.id, name: record.name, ownerId: record.ownerId,
      createdAt: Date.parse(record.createdAt), updatedAt: Date.parse(record.updatedAt),
    }
  }

  private persist(project: Project) {
    if (!this.durableStorage) return
    void this.durableStorage.saveProject({
      id: project.id, name: project.name, ownerId: project.ownerId, status: 'active',
      createdAt: new Date(project.createdAt).toISOString(), updatedAt: new Date(project.updatedAt).toISOString(),
    }).catch((error) => this.ctx.logger('project-registry').warn('failed to persist project: %s', String(error)))
  }
}

export const apply = async (ctx: Context) => { await ctx.plugin(ProjectRegistry) }
