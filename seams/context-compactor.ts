import { Context, Service } from '@deepseek-ai/cordis'
import { LlmMessage, LlmToolSpec } from './llm.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    contextCompactor: ContextCompactorService
  }
}

export interface ContextInspection {
  estimatedTokens: number
  contextLimitTokens: number
  compactionTriggerTokens: number
  compactionProgressPercent: number
  nearCompaction: boolean
  shouldCompact: boolean
}

export interface StructuredSummaryInput {
  systemPrompt: string
  payload: unknown
  requiredFields: string[]
  maxTokens?: number
  signal?: AbortSignal
}

export interface CompactContextResult {
  messages: LlmMessage[]
  summary: string
  quality: 'semantic' | 'fallback'
  error?: string
}

/**
 * Quản lý kích thước model context trong MỘT request. Đây không phải memory
 * dài hạn và không sở hữu Session; loop quyết định lúc inspect/compact.
 */
export abstract class ContextCompactorService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'contextCompactor')
  }

  abstract inspect(messages: LlmMessage[], tools?: LlmToolSpec[]): ContextInspection
  abstract compact(messages: LlmMessage[], options?: { signal?: AbortSignal }): Promise<CompactContextResult>
  abstract structuredSummary(input: StructuredSummaryInput): Promise<Record<string, string>>
}
