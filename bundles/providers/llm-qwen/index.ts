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
import { postChatCompletion } from "../shared/llm-http.ts";

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

  async complete(
    messages: LlmMessage[],
    options: LlmCompleteOptions = {},
  ): Promise<LlmCompletion> {
    const { apiKey, baseUrl, model: configuredModel } = this.resolveConfig();
    const model = options.model ?? configuredModel;

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
