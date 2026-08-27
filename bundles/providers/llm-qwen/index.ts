// bundles/providers/llm-qwen/index.ts
//
// Wraps the OpenAI-compatible proxy already used in production by the
// `data-agent` Python repo (proxy.onebot.meobeo.ai, model
// hosted_vllm/Qwen/Qwen3.5-35B-A3B-FP8) as a Cordis `ctx.llm` provider.
// Pattern A (HTTP call per `complete()`, nothing to load into RAM / keep open).
//
// Both request shapes below were verified live against the real proxy before
// writing this file (see checklist item in the template, section 5/6):
//   - Plain chat completion with `chat_template_kwargs: { enable_thinking: false }`.
//   - Native OpenAI-style tool-calling (`tools` + `tool_choice: "auto"` ->
//     `message.tool_calls[]`), which DOES work on this endpoint.
import { Context, Service } from "@deepseek-ai/cordis";
import {
  LlmCompleteOptions,
  LlmCompletion,
  LlmError,
  LlmMessage,
  LlmService,
  LlmToolCall,
} from "../../../seams/llm.ts";
import { postChatCompletion, statusError } from "../shared/llm-http.ts";

export namespace LlmQwen {
  export interface Config {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    /** Output token budget. Default matches this endpoint's own client code (MAX_OUTPUT_TOKENS=4096). */
    maxTokens?: number;
    /** Per-request abort timeout in ms. Default 60s. */
    timeoutMs?: number;
    /**
     * Qwen3.5 "thinking" mode: when true (or omitted upstream), the model can spend its
     * entire `maxTokens` budget on `reasoning_content` and return `content: null` if the
     * budget runs out first -- reproduced live while building this file (finish_reason
     * "length", content null, with only 20 max_tokens). Defaults to false, matching the
     * `data-agent` repo's own production config (`config.yaml` / `.env`
     * OPENAI_EXTRA_BODY.chat_template_kwargs.enable_thinking).
     */
    enableThinking?: boolean;
    /** Extra fields merged into the request body verbatim (proxy-specific passthrough). */
    extraBody?: Record<string, unknown>;
    /**
     * Phase 8.3 (coding rule A14 sibling gap): retry count for TRANSIENT
     * failures only (network throw, 429, 5xx) -- default 2 (3 total
     * attempts). Auth/bad-request errors (401/403/400...) are never retried,
     * they will fail identically again. Backoff is exponential:
     * `retryBaseDelayMs * 2^attempt`.
     */
    maxRetries?: number;
    /** Base backoff delay in ms before the exponential multiplier. Default 300ms. */
    retryBaseDelayMs?: number;
  }
}

/**
 * Fallback env vars intentionally reuse the `data-agent` repo's own names
 * (OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL_ID) instead of a
 * `QWEN_*`-prefixed set, so the same `.env` already provisioned for that
 * proxy can be reused as-is when deploying this provider. Deviation from the
 * template's `<TEN>_API_KEY` example is deliberate, not an oversight.
 *
 * NO hardcoded fallback for baseUrl/model: those identify a SPECIFIC piece
 * of infrastructure (which proxy, which deployed model). A silent fallback
 * baked into source would make a misconfigured deployment quietly talk to
 * the wrong endpoint instead of failing loudly at boot -- same reasoning as
 * apiKey already having no fallback. maxTokens/timeoutMs stay as real
 * defaults below: they are generic tunables, not infra identifiers.
 */
const DEFAULT_MAX_TOKENS = 4096;

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIChatResponse {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
}

// Follow-up (2026-08) — streaming (SSE): shape của 1 chunk `data: {...}` khi
// `stream: true`. Verify TRỰC TIẾP với proxy thật (không phải suy đoán từ
// docs OpenAI) trước khi viết parser dưới đây — 3 phát hiện quan trọng khớp
// đúng chunk thật: (1) chunk tool_call ĐẦU TIÊN mang cả `name` lẫn mảnh
// `arguments` rỗng, các chunk SAU chỉ còn mảnh `arguments` (phải tích luỹ
// dần, không thay thế); (2) `usage` CHỈ xuất hiện ở chunk CUỐI (sau
// `[DONE]` không còn chunk nào), và CHỈ khi request có `stream_options:
// {include_usage: true}` -- thiếu field này thì stream im lặng không có usage;
// (3) model có thể phát NHIỀU tool_call trong 1 response (mỗi cái 1
// `index` riêng, 0/1/2...) khi tự quyết định làm nhiều lượt search cùng lúc
// -- bug thật đã gặp lúc verify E2E: nối lẫn `arguments` của index 1 vào
// buffer của index 0 (đọc `tool_calls[0]` theo VỊ TRÍ MẢNG thay vì theo field
// `.index`) tạo ra 2 JSON object dính liền nhau, JSON.parse() throw, args
// cuối cùng RỖNG dù model có ý định rõ ràng. Phải lọc đúng `.index === 0`.
interface OpenAIStreamChunk {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  choices?: Array<{
    finish_reason?: string;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class LlmQwen extends LlmService {
  constructor(
    ctx: Context,
    public config: LlmQwen.Config = {},
  ) {
    super(ctx);
  }

  // Đọc CHUNG 1 chỗ cho cả [Service.init]() lẫn complete() -- 2 nơi phải
  // validate giống hệt nhau (fail sớm lúc mount, và fail lại nếu ai gọi
  // complete() trực tiếp mà bỏ qua init), không có nơi nào "quên" 1 field.
  private resolveConfig(): ResolvedConfig {
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY;
    const baseUrl = this.config.baseUrl ?? process.env.OPENAI_BASE_URL;
    const model = this.config.model ?? process.env.OPENAI_MODEL_ID;
    const missing = [
      !apiKey && "apiKey (config.apiKey hoặc OPENAI_API_KEY)",
      !baseUrl && "baseUrl (config.baseUrl hoặc OPENAI_BASE_URL)",
      !model && "model (config.model hoặc OPENAI_MODEL_ID)",
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(`llm-qwen: missing required config: ${missing.join(", ")}`);
    }
    return { apiKey: apiKey!, baseUrl: baseUrl!, model: model! };
  }

  // No real resource to open (Pattern A) -- only validates config early so a missing
  // key/baseUrl/model fails at mount time instead of on the first user-facing
  // `complete()` call.
  [Service.init]() {
    const { model, baseUrl } = this.resolveConfig();
    this.ctx.logger("llm-qwen").info("ready (model=%s, baseUrl=%s)", model, baseUrl);
  }

  // Tách chung cho complete()/completeStream() -- 2 chỗ phải build body GIỐNG
  // HỆT nhau (trừ đúng field `stream`/`stream_options`), tránh 1 nơi quên cập
  // nhật khi sau này thêm option mới.
  private buildRequestBody(model: string, messages: LlmMessage[], options: LlmCompleteOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: messages.map(mapMessage),
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      chat_template_kwargs: {
        enable_thinking: this.config.enableThinking ?? false,
      },
      ...this.config.extraBody,
      ...options.extraBody,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;

    if (options.tools?.length) {
      body.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: "object", properties: {} },
        },
      }));
      body.tool_choice = "auto";
    }
    return body;
  }

  async complete(
    messages: LlmMessage[],
    options: LlmCompleteOptions = {},
  ): Promise<LlmCompletion> {
    const { apiKey, baseUrl, model: configuredModel } = this.resolveConfig();
    const model = options.model ?? configuredModel;
    const body = this.buildRequestBody(model, messages, options);

    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const res = await postChatCompletion({
      url, apiKey, body,
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      retryBaseDelayMs: this.config.retryBaseDelayMs,
      signal: options.signal,
      deadline: options.deadline,
      warn: (message, ...args) => this.ctx.logger('llm-qwen').warn(message, ...args),
    }, 'llm-qwen');
    const data = (await res.json()) as OpenAIChatResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;

    // Only the first tool call is surfaced: LlmCompletion.toolCall is a single optional
    // field, not an array, so a model reply with multiple tool_calls would silently drop
    // the rest. Not observed against this endpoint in testing, but documented per the
    // template's rule on simplifications (section 4).
    const rawCall = message?.tool_calls?.[0];
    const toolCall: LlmToolCall | undefined = rawCall
      ? {
          name: rawCall.function.name,
          args: parseArgs(rawCall.function.arguments),
        }
      : undefined;

    return {
      content: message?.content ?? "",
      toolCall,
      model: data.model ?? model,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            cost: data.usage.cost,
          }
        : undefined,
    };
  }

  // Follow-up (2026-08) — streaming: dùng CHUNG `postChatCompletion()` với
  // complete() (merge feat/rlm-dev-integration đưa vào) -- retry-with-backoff
  // + signal/deadline cancellation giờ nhất quán giữa 2 method, không tự chế
  // AbortController/timeout riêng nữa (bản đầu KHÔNG hề nhận options.signal,
  // nghĩa là 1 turn bị cancel giữa chừng vẫn treo nguyên request streaming --
  // gap thật phát hiện lúc merge, không phải giả thuyết). Retry CHỈ áp dụng
  // cho request BAN ĐẦU (trước khi response.ok, tức trước khi có byte nào
  // stream về) -- 1 request đã stream được vài đoạn rồi mới lỗi giữa chừng sẽ
  // KHÔNG bị retry (đọc thẳng logic postChatCompletion: retry dựa trên kết
  // quả fetch() đầu tiên, không đụng gì tới việc đọc body sau đó), tránh phát
  // lại đoạn ĐÃ hiện cho user -- giữ đúng tinh thần đơn giản hoá đã ghi trước
  // đây, chỉ khác là giờ CÓ cancellation đúng thay vì tự chế thiếu sót.
  // `onDelta` gọi ngay khi có content mới, KHÔNG đợi tới lúc xong toàn bộ.
  async completeStream(
    messages: LlmMessage[],
    options: LlmCompleteOptions = {},
    onDelta: (contentDelta: string) => void,
  ): Promise<LlmCompletion> {
    const { apiKey, baseUrl, model: configuredModel } = this.resolveConfig();
    const model = options.model ?? configuredModel;
    const body = {
      ...this.buildRequestBody(model, messages, options),
      stream: true,
      stream_options: { include_usage: true },
    };

    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    // Merge feat/rlm-dev-integration (round 2): feature branch tự viết lại
    // hoàn toàn nhánh này bằng fetch() trần + AbortController riêng (bỏ
    // postChatCompletion) — ĐƯỢC 1 điểm bản này chưa có (cancel `reader` dứt
    // khoát trong `finally` khi bị abort/timeout giữa chừng), nhưng MẤT retry-
    // with-backoff nhất quán với complete() (không dùng postChatCompletion
    // nữa). Giữ postChatCompletion cho pha connect (retry đúng như trước),
    // thêm try/catch/finally bọc NGOÀI để có cleanup reader + typed LlmError
    // cho lỗi xảy ra TRONG lúc đọc stream (khác lỗi lúc connect,
    // postChatCompletion đã tự phân loại đúng rồi) — lấy đủ cả 2 điểm mạnh.
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await postChatCompletion({
        url, apiKey, body,
        timeoutMs: this.config.timeoutMs,
        maxRetries: this.config.maxRetries,
        retryBaseDelayMs: this.config.retryBaseDelayMs,
        signal: options.signal,
        deadline: options.deadline,
        warn: (message, ...args) => this.ctx.logger('llm-qwen').warn(message, ...args),
      }, 'llm-qwen');
      if (!res.body) {
        throw new LlmError("LLM_NETWORK", "llm-qwen: streaming response has no body");
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let toolCallName: string | undefined;
      let toolCallArgsRaw = "";
      let responseModel: string | undefined;
      let usage: LlmCompletion["usage"];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          let chunk: OpenAIStreamChunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // 1 dòng SSE lẻ hỏng/rỗng -- bỏ qua, không làm vỡ cả stream.
          }
          responseModel ??= chunk.model;
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
              cost: chunk.usage.cost,
            };
          }
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            onDelta(delta.content);
          }
          // Chỉ giữ tool call ĐẦU TIÊN (index 0) -- khớp đúng giới hạn đã có ở
          // complete() (LlmCompletion.toolCall là 1 field, không phải mảng --
          // model trả nhiều tool_calls thì chỉ cái đầu được surface, xem ghi
          // chú ở đó). Fragment của tool_call SAU (index >= 1) BỎ QUA hoàn
          // toàn -- KHÔNG được đọc `tool_calls[0]` theo vị trí mảng rồi nối
          // bừa vào cùng buffer, sẽ dính 2 JSON object của 2 tool_call khác
          // nhau thành 1 chuỗi không hợp lệ (bug thật đã gặp, xem ghi chú tại
          // khai báo OpenAIStreamChunk).
          const toolCallDelta = delta?.tool_calls?.find((tc) => (tc.index ?? 0) === 0);
          if (toolCallDelta?.function?.name) toolCallName = toolCallDelta.function.name;
          if (toolCallDelta?.function?.arguments) toolCallArgsRaw += toolCallDelta.function.arguments;
        }
      }

      const toolCall: LlmToolCall | undefined = toolCallName
        ? { name: toolCallName, args: parseArgs(toolCallArgsRaw) }
        : undefined;
      return { content, toolCall, model: responseModel ?? model, usage };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (options.signal?.aborted) throw new LlmError("LLM_CANCELLED", "llm-qwen: cancelled");
      throw new LlmError("LLM_NETWORK", `llm-qwen: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (options.signal?.aborted && reader) {
        await reader.cancel().catch(() => undefined);
      }
    }
  }

}

function mapMessage(message: LlmMessage): OpenAIChatMessage {
  // The seam's role:'tool' carries no tool_call_id, so it cannot be reconstructed into a
  // valid OpenAI tool-result message (which requires one). Downgrading to 'user' with a
  // prefix is the template-sanctioned simplification (section 4, same as llm-deepseek) --
  // this always produces a valid request instead of a request the API would reject.
  if (message.role === "tool") {
    return { role: "user", content: `[Tool result]: ${message.content}` };
  }
  return { role: message.role, content: message.content };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export const apply = async (ctx: Context, config: LlmQwen.Config = {}) => {
  await ctx.plugin(LlmQwen, config);
};
