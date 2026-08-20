// seams/subagents.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/subagent-manager.
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    subagents: SubagentRegistryService
  }
}

export interface SubagentDefinition {
  name: string
  run(task: string): Promise<string>
}

export abstract class SubagentRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'subagents')
  }

  /**
   * Đăng ký 1 subagent. Cùng ràng buộc như ToolRegistryService.add —
   * implementation phải gắn disposer qua `ctx.effect()` để tự gỡ đúng
   * fiber gọi.
   */
  abstract register(def: SubagentDefinition): void
  abstract get(name: string): SubagentDefinition | undefined
  abstract has(name: string): boolean
}
