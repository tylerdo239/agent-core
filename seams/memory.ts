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

export abstract class MemoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  abstract remember(sessionId: string, text: string): Promise<void>
  abstract recall(sessionId: string, query: string, limit?: number): Promise<MemoryEntry[]>
}
