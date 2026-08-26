import { createHash, randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/storage.ts'
import '../../../seams/workspace.ts'
import { type ArtifactInput, ArtifactService } from '../../../seams/artifacts.ts'

export class ArtifactCatalog extends ArtifactService {
  async register(input: ArtifactInput) {
    if (!input.path || !input.kind || !input.producer) throw new Error('artifact requires path, kind and producer')
    const workspace = this.ctx.get('workspace')
    if (workspace && input.sessionId) {
      const content = await workspace.readFile(input.sessionId, input.path)
      const actualHash = createHash('sha256').update(content).digest('hex')
      if (content.byteLength !== input.size) throw new Error(`artifact size mismatch for "${input.path}"`)
      if (actualHash !== input.sha256) throw new Error(`artifact checksum mismatch for "${input.path}"`)
    }
    const record = { ...input, id: input.id ?? randomUUID(), createdAt: new Date().toISOString() }
    await this.ctx.storage.putArtifact(record)
    return record
  }
  get(id: string) { return this.ctx.storage.getArtifact(id) }
  list(filter = {}) { return this.ctx.storage.listArtifacts(filter) }
}

export const inject = ['storage']
export const apply = async (ctx: Context) => { await ctx.plugin(ArtifactCatalog) }
