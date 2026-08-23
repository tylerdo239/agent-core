// seams/turn-memory.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/providers/memory-rolling.
//
// Tách ra từ nhánh RLM harness migration (xem
// docs/agent-core-rlm-harness-merge-plan.md mục 4.1) — nguyên bản nhánh đó
// mở rộng THẲNG vào `ctx.memory`/`MemoryService`, nhưng đó là seam đã có
// capability khác hẳn ở `dev` (remember/recall xuyên session/user qua
// TencentDB Agent Memory, xem seams/memory.ts, Phase 25). 2 khái niệm thật
// sự khác nhau — rolling memory ở ĐÂY chỉ nén `Session.history` thành 1
// summary semantic theo TỪNG SESSION, dùng riêng để nạp vào loop-rlm mỗi
// lượt (không phải tra cứu ngữ nghĩa xuyên session/user) — tách seam riêng
// đúng tinh thần "1 capability rõ ràng = 1 seam" áp dụng xuyên suốt repo,
// thay vì ép 1 provider phải implement cả 2 interface không liên quan.
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    turnMemory: TurnMemoryService
  }
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

/** Raw result của loop; provider turnMemory tự quyết định cách tóm tắt/persist. */
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

export abstract class TurnMemoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'turnMemory')
  }

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
