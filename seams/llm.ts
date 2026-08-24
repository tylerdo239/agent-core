// seams/llm.ts — Service Definition. KHÔNG chứa implementation.
// Provider mặc định: bundles/providers/llm-qwen. Provider thay thế:
// bundles/providers/llm-deepseek (Phase 2) — vẫn hợp lệ, đổi lại trong
// src/serve.ts nếu muốn dùng.
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmService
  }
}

export interface LlmToolCall {
  name: string
  args: Record<string, unknown>
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface LlmCompletion {
  content: string
  toolCall?: LlmToolCall
  model?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cost?: number
  }
}

/** Quảng bá 1 tool cho model — map trực tiếp từ ToolDefinition (seams/tools.ts). */
export interface LlmToolSpec {
  name: string
  description: string
  parameters?: Record<string, unknown>
}

export interface LlmCompleteOptions {
  /** Tool khả dụng cho lượt gọi này. Rỗng/undefined = model không được đề nghị gọi tool. */
  tools?: LlmToolSpec[]
  model?: string
  temperature?: number
  maxTokens?: number
  purpose?: 'root' | 'sub' | 'memory'
  extraBody?: Record<string, unknown>
  signal?: AbortSignal
  /** Absolute epoch deadline shared across retries. */
  deadline?: number
}

export type LlmErrorCode = 'LLM_CANCELLED' | 'LLM_TIMEOUT' | 'LLM_RATE_LIMITED' | 'LLM_SERVER_ERROR' | 'LLM_AUTH' | 'LLM_REQUEST_INVALID' | 'LLM_NETWORK'
export class LlmError extends Error {
  constructor(public readonly code: LlmErrorCode, message: string, public readonly status?: number) {
    super(message); this.name = 'LlmError'
  }
}

export abstract class LlmService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  abstract complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<LlmCompletion>
}
