// seams/memory.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật (TencentDB Agent Memory MemoryCore): bundles/providers/memory-tencentdb.
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

// userId map tới Session.ownerId (auth module) -- cho phép provider scope bộ
// nhớ theo TỪNG NGƯỜI DÙNG thật thay vì theo session, dù 1 instance provider
// dùng chung cho nhiều user. Optional vì call site có thể chưa có identity
// (session ẩn danh) -- provider tự quyết định fallback (vd. 'anonymous').
export interface MemoryContext {
  userId?: string
}

export abstract class MemoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  abstract remember(sessionId: string, text: string, context?: MemoryContext): Promise<void>
  abstract recall(sessionId: string, query: string, limit?: number, context?: MemoryContext): Promise<MemoryEntry[]>
}
