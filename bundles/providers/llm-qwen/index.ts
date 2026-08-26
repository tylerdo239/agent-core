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
  LlmMessage,
  LlmService,
  LlmToolCall,
} from "../../../seams/llm.ts";

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
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    const res = await this.fetchWithRetry(url, apiKey, body);
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

  // Follow-up (2026-08) — streaming: KHÔNG retry (khác complete()/
  // fetchWithRetry) -- 1 request đã stream được VÀI đoạn rồi mới lỗi giữa
  // chừng, retry lại từ đầu sẽ phát lại đoạn ĐÃ hiện cho user (đơn giản hoá
  // có chủ đích, ghi rõ ra đây thay vì tự tin ẩn giấu: lỗi giữa chừng nổi lên
  // như bất kỳ lỗi nào khác của turn, qua đúng đường xử lý lỗi đã có sẵn ở
  // loop-default/agent-runner). `onDelta` gọi ngay khi có content mới, KHÔNG
  // đợi tới lúc xong toàn bộ mới gọi 1 lần.
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
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok || !res.body) {
      throw new Error(`llm-qwen: streaming request failed (${res.status} ${res.statusText})`);
    }

    const reader = res.body.getReader();
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

    return {
      content,
      toolCall,
      model: responseModel ?? model,
      usage,
    };
  }

  // Phase 8.3: retry chỉ cho lỗi TRANSIENT (throw trước khi có response --
  // network/DNS/reset/abort -- hoặc response 429/5xx). Lỗi 4xx khác (auth
  // sai, request sai) throw ngay lần đầu, không retry -- request đó sẽ fail
  // y hệt lần nữa. `res`/`networkError` tách riêng (không dùng try/catch để
  // phân loại lại lỗi) để không cần đoán lỗi nào tới từ đâu qua message string.
  private async fetchWithRetry(
    url: string,
    apiKey: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
    const baseDelay = this.config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response | undefined;
      let networkError: unknown;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        networkError = err;
      } finally {
        clearTimeout(timeout);
      }

      if (res?.ok) return res;
      if (res && !RETRYABLE_STATUS.has(res.status)) {
        throw new Error(`llm-qwen: request failed (${res.status} ${res.statusText})`);
      }
      if (attempt >= maxRetries) {
        if (res) throw new Error(`llm-qwen: request failed (${res.status} ${res.statusText})`);
        throw networkError;
      }
      this.ctx
        .logger("llm-qwen")
        .warn(
          "retry %d/%d after %s",
          attempt + 1,
          maxRetries,
          res ? `HTTP ${res.status}` : `network error: ${(networkError as Error).message}`,
        );
      await sleep(baseDelay * 2 ** attempt);
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
