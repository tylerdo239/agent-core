// seams/sandbox.ts — Service Definition. KHÔNG chứa implementation.
// Chưa có provider trong Phase 0-3 (sandbox-local/sandbox-remote nằm ngoài scope hiện tại).
// Coding rule B2: bất kỳ tool nào chạy code không tin cậy (Python/MCP) BẮT BUỘC
// đi qua seam này hoặc ghi rõ lý do tại sao không.
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandbox: SandboxService
  }
}

export interface SandboxRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface SandboxSessionOptions {
  cwd: string
  metadata?: Record<string, unknown>
}

export interface SandboxEvent {
  type: string
  [key: string]: unknown
}

export abstract class SandboxService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sandbox')
  }

  abstract run(code: string, language: string): Promise<SandboxRunResult>
  /** Mở runtime persistent gắn 1-1 với session; gọi lại cùng session là idempotent. */
  abstract openSession(sessionId: string, options: SandboxSessionOptions): Promise<void>
  /** Gửi một operation và stream các event JSON của worker. */
  abstract request(
    sessionId: string,
    operation: string,
    payload?: Record<string, unknown>,
  ): AsyncIterable<SandboxEvent>
  abstract closeSession(sessionId: string): Promise<void>
}
