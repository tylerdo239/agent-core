// seams/memory.ts — Service Definition. KHÔNG chứa implementation.
// Chưa có provider trong Phase 0-3 (memory-vector nằm ngoài scope hiện tại).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}

export interface MemoryEntry {
  id: string
  text: string
  score?: number
}

export interface RollingMemoryUpdate {
  summary: string
  turnSummary: string
  quality?: string
  error?: string
}

export interface RollingTurnInput {
  update: RollingMemoryUpdate
  state: string
  request: string
  contexts: string[]
  historyIndex?: number
}

/** Raw result của loop; provider memory tự quyết định cách tóm tắt/persist. */
export interface CompleteTurnInput {
  state: string
  request: string
  outcome: unknown
  trajectory?: Record<string, unknown>
  contexts: string[]
  historyIndex?: number
}

export interface CompleteTurnResult {
  update: RollingMemoryUpdate
  turn: Record<string, unknown>
}

export interface RollingMemorySnapshot {
  summary: string
  turns: Array<Record<string, unknown>>
  currentContext?: string
  resources: {
    datasets: Array<Record<string, unknown>>
    artifacts: string[]
  }
}

export abstract class MemoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  abstract remember(sessionId: string, text: string): Promise<void>
  abstract recall(sessionId: string, query: string, limit?: number): Promise<MemoryEntry[]>
  abstract snapshot(
    sessionId: string,
    options?: {
      activeDatasets?: Array<Record<string, unknown>>
      artifacts?: string[]
      currentContextIndex?: number
    },
  ): Promise<RollingMemorySnapshot>
  abstract summary(sessionId: string): Promise<string>
  abstract sourceContexts(sessionId: string, currentContextIndex?: number): Promise<string[]>
  abstract recordContext(sessionId: string, contextIndex: number): Promise<void>
  abstract recordTurn(sessionId: string, input: RollingTurnInput): Promise<Record<string, unknown>>
  abstract completeTurn(sessionId: string, input: CompleteTurnInput): Promise<CompleteTurnResult>
  abstract clear(sessionId: string): Promise<void>
}
