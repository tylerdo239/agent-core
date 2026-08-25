import { Context, Service } from '@deepseek-ai/cordis'
import type { SkillDefinition } from './skill.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillSelection: SkillSelectionService
  }
}

export interface SkillSelectionResult {
  skill?: SkillDefinition
  model?: string
  usage?: Record<string, unknown>
  /** Bounded router output for audit/debug; never treated as instructions. */
  decision?: string
}

/** Optional semantic router for runtimes that cannot reliably tool-call before execution. */
export abstract class SkillSelectionService extends Service {
  constructor(ctx: Context) { super(ctx, 'skillSelection') }
  abstract select(message: string, candidates: SkillDefinition[], signal?: AbortSignal): Promise<SkillSelectionResult>
}
