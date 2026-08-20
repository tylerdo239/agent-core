// bundles/subagent-manager — provider cho seam ctx.subagents.
// Cùng pattern effect-scoping với bundles/tool-registry — xem comment ở đó.
import { Context } from '@deepseek-ai/cordis'
import { SubagentDefinition, SubagentRegistryService } from '../../../seams/subagents.ts'

export class SubagentManager extends SubagentRegistryService {
  private subagents = new Map<string, SubagentDefinition>()

  register(def: SubagentDefinition) {
    this.ctx.effect(() => {
      if (this.subagents.has(def.name)) {
        throw new Error(`subagent "${def.name}" already registered`)
      }
      this.subagents.set(def.name, def)
      this.ctx.logger('subagent-manager').info('registered subagent "%s"', def.name)
      return () => {
        this.subagents.delete(def.name)
        this.ctx.logger('subagent-manager').info('unregistered subagent "%s"', def.name)
      }
    }, `ctx.subagents.register(${JSON.stringify(def.name)})`)
  }

  get(name: string) {
    return this.subagents.get(name)
  }

  has(name: string) {
    return this.subagents.has(name)
  }
}

export const apply = async (ctx: Context) => {
  await ctx.plugin(SubagentManager)
}
