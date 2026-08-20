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
}

export abstract class LlmService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  abstract complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<LlmCompletion>
}
