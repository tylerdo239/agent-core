// bundles/llm-deepseek — provider cho seam ctx.llm (Phase 2, nâng cấp ở Phase 4
// để hỗ trợ tool-calling thật cho agent loop).
//
// Đơn giản hoá có chủ đích (ghi rõ ra đây, không âm thầm bỏ qua): API tool-
// calling chuẩn OpenAI/DeepSeek yêu cầu round-trip `tool_call_id` khớp giữa
// message `assistant` (chứa `tool_calls`) và message `tool` trả kết quả.
// Seam `LlmMessage` ở đây KHÔNG track id đó (giữ đúng độ đơn giản của plan
// gốc: role 'tool' chỉ là text mô tả kết quả). Vì vậy khi gửi lên API thật,
// message role 'tool' được map thành role 'user' có tiền tố — hy sinh 1 chút
// độ trung thực với giao thức tool-calling gốc để đổi lấy: luôn là request
// hợp lệ với bất kỳ API tương thích OpenAI nào, không phụ thuộc bookkeeping
// id. Nếu sau này cần function-calling multi-turn đúng chuẩn, đây là chỗ
// cần mở rộng trước (thêm `toolCall.id` vào seam).
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../../../seams/llm.ts'
import { postChatCompletion } from '../shared/llm-http.ts'

export namespace LlmDeepseek {
  export interface Config {
    apiKey?: string
    baseUrl?: string
    model?: string
    timeoutMs?: number
    maxRetries?: number
    retryBaseDelayMs?: number
  }
}

interface WireMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function toWireMessages(messages: LlmMessage[]): WireMessage[] {
  return messages.map((m): WireMessage =>
    m.role === 'tool'
      ? { role: 'user', content: `[tool result] ${m.content}` }
      : { role: m.role, content: m.content },
  )
}

export class LlmDeepseek extends LlmService {
  constructor(ctx: Context, public config: LlmDeepseek.Config = {}) {
    super(ctx)
  }

  [Service.init]() {
    const apiKey = this.config.apiKey ?? process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error('llm-deepseek: missing apiKey (config.apiKey or DEEPSEEK_API_KEY)')
    }
    this.ctx.logger('llm-deepseek').info('ready (model=%s)', this.config.model ?? 'deepseek-chat')
    return () => {
      this.ctx.logger('llm-deepseek').info('detached')
    }
  }

  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    const apiKey = this.config.apiKey ?? process.env.DEEPSEEK_API_KEY
    const baseUrl = this.config.baseUrl ?? 'https://api.deepseek.com'
    const model = options.model ?? this.config.model ?? 'deepseek-chat'

    const body: Record<string, unknown> = {
      model,
      messages: toWireMessages(messages),
      ...options.extraBody,
    }
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
    if (options.tools?.length) {
      body.tools = options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: 'object', properties: {} },
        },
      }))
    }

    const res = await postChatCompletion({
      url: `${baseUrl.replace(/\/$/, '')}/chat/completions`, apiKey: apiKey!, body,
      timeoutMs: this.config.timeoutMs, maxRetries: this.config.maxRetries,
      retryBaseDelayMs: this.config.retryBaseDelayMs,
      signal: options.signal, deadline: options.deadline,
      warn: (message, ...args) => this.ctx.logger('llm-deepseek').warn(message, ...args),
    }, 'llm-deepseek')

    const data = (await res.json()) as {
      model?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number }
      choices: { message: { content: string | null; tool_calls?: WireToolCall[] } }[]
    }

    const message = data.choices[0]?.message
    const call = message?.tool_calls?.[0]
    return {
      content: message?.content ?? '',
      toolCall: call
        ? { name: call.function.name, args: JSON.parse(call.function.arguments || '{}') }
        : undefined,
      model: data.model ?? model,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            cost: data.usage.cost,
          }
        : undefined,
    }
  }
}

export const apply = async (ctx: Context, config: LlmDeepseek.Config = {}) => {
  await ctx.plugin(LlmDeepseek, config)
}
