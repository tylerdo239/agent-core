import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    projects: ProjectRegistryService
  }
}

export interface Project {
  id: string
  name: string
  ownerId: string
  createdAt: number
  updatedAt: number
}

export interface CreateProjectOptions {
  id?: string
  name: string
  ownerId: string
}

/** Projects own shared data sources; sessions own individual conversations. */
export abstract class ProjectRegistryService extends Service {
  constructor(ctx: Context) { super(ctx, 'projects') }

  abstract create(options: CreateProjectOptions): Project
  abstract get(id: string): Project | undefined
  abstract list(): Project[]
  abstract rename(id: string, name: string): Project | undefined
  abstract touch(id: string): Project | undefined
  abstract remove(id: string): boolean
}
