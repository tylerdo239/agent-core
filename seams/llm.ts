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
}

export abstract class LlmService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  abstract complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<LlmCompletion>

  /**
   * Follow-up (2026-08) — user báo chưa thấy trả lời "gõ từng chữ" như
   * Claude/ChatGPT. Tuỳ chọn (KHÔNG bắt buộc mọi provider implement — coding
   * rule A6): provider nào hỗ trợ SSE thật (đã verify trực tiếp với
   * `proxy.onebot.meobeo.ai`, xem bundles/providers/llm-qwen) thì thêm method
   * này; loop driver tự kiểm tra có tồn tại hay không (feature-detect) rồi
   * rơi về `complete()` nếu provider (hoặc fake LLM trong test) không có —
   * không phá vỡ provider/test hiện có.
   *
   * `onDelta` gọi MỖI LẦN có thêm nội dung mới (không tích luỹ sẵn, caller tự
   * ghép). Trả về `LlmCompletion` HOÀN CHỈNH giống hệt `complete()` khi
   * request xong (đầy đủ content/toolCall/usage) — deltas chỉ là "live tap"
   * để hiện tiến trình, không thay thế giá trị trả về cuối cùng.
   */
  completeStream?(
    messages: LlmMessage[],
    options: LlmCompleteOptions,
    onDelta: (contentDelta: string) => void,
  ): Promise<LlmCompletion>
}
