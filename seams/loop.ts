// seams/loop.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/loop-registry (đăng ký driver) + bundles/loop-default (driver mặc định).
//
// Seam này KHÔNG có trong bảng Phase 1 gốc (plan gốc chỉ liệt kê llm/storage/
// memory/tools/permission/sandbox/subagents) — Phase 4 cần thêm 1 capability
// mới ("nơi các loop driver có thể hot-swap được đăng ký"), nên áp dụng đúng
// coding rule A1: viết interface ở đây TRƯỚC, rồi mới viết provider. Đây
// chính là chỗ Phase 5 (chaos hot-swap) sẽ dùng để swap `loop-default` ↔
// `loop-planner-critic` mà không restart hệ thống.
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmMessage, LlmToolCall } from './llm.ts'
import { ToolUiHint } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    loop: LoopRegistryService
  }
  interface Events {
    /**
     * Phase 6: phát ngay tại đúng chỗ driver ghi `storage.appendEvent` —
     * KHÔNG phải nguồn sự thật thứ 2 tách rời storage, chỉ là "live tap" cho
     * adapter cần stream (WS, gRPC server-streaming). REST không cần nghe.
     */
    'agent/step'(event: { sessionId: string; step: LoopStep }): void
  }
}

export interface LoopTurnResult {
  content: string
  steps: number
  /** Trạng thái cuối của turn. Driver cũ có thể bỏ qua và được hiểu là completed. */
  status?: 'completed' | 'waiting_user' | 'waiting_approval' | 'failed'
  /** Payload có cấu trúc cho ask-user/action-approval. */
  control?: Record<string, unknown>
  usage?: Record<string, unknown>
  tracePath?: string
}

/** Input ổn định của một turn; metadata không bị trộn vào nội dung user. */
export interface TurnInput {
  message: string
  selectedSkill?: string
  metadata?: Record<string, unknown>
  /** Idempotency key supplied by an adapter/client. */
  requestId?: string
  /** Cooperative cancellation signal owned by AgentRunner. */
  signal?: AbortSignal
  /** Correlation id assigned by AgentRunner; callers normally omit it. */
  runId?: string
}

export class RunCancelledError extends Error {
  constructor(message = 'run cancelled') {
    super(message)
    this.name = 'RunCancelledError'
  }
}

export function assertNotCancelled(input: TurnInput): void {
  if (input.signal?.aborted) throw new RunCancelledError()
}

export function isCancellation(error: unknown): boolean {
  return error instanceof RunCancelledError || (error instanceof Error && error.name === 'AbortError')
}

export function normalizeTurnInput(input: string | TurnInput): TurnInput {
  return typeof input === 'string' ? { message: input } : input
}

export type LoopStep =
  // Phase 8.5: `toolUi` là metadata do chính tool khai (ToolDefinition.ui,
  // xem seams/tools.ts), driver chỉ forward — KHÔNG phải state mới, KHÔNG
  // phải nơi loop driver tự quyết định cách hiển thị. UI (web-ui) đọc field
  // này thay vì hardcode theo tên tool.
  | { type: 'model_message'; content: string; toolCall?: LlmToolCall; toolUi?: ToolUiHint }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; toolUi?: ToolUiHint }
  | { type: 'tool_result'; name: string; result: unknown; toolUi?: ToolUiHint }
  | { type: 'critic_message'; content: string }
  | { type: 'final'; content: string }
  | { type: 'turn_started'; runId: string; contextIndex?: number }
  | { type: 'iteration_started' | 'iteration_completed'; iteration: number; depth?: number; duration?: number }
  | { type: 'analysis'; content: string; iteration?: number; decisionSummary?: string }
  /** RLM accessed a selected skill or one of its lazy resources. */
  | { type: 'skill_loaded' | 'skill_resource'; skill: string; path?: string; encoding?: string }
  /** A workspace helper is about to read/list a file or dataset. */
  | { type: 'workspace_read'; action: string; path?: string }
  /** A REPL helper wrote an output artifact. */
  | { type: 'workspace_write'; path: string }
  | { type: 'code'; code: string; iteration?: number; block?: number }
  | { type: 'observation'; stdout: string; stderr: string; success: boolean; iteration?: number; block?: number }
  | { type: 'subcall_result'; data: Record<string, unknown> }
  | { type: 'context_usage'; data: Record<string, unknown> }
  | { type: 'memory_updated'; data: Record<string, unknown> }
  | { type: 'human_decision'; control: Record<string, unknown> }
  | { type: 'error'; message: string }

/**
 * `runCtx` là tham số BẮT BUỘC, không phải tiện ích — xem coding rule A12.
 * Driver bundle KHÔNG được đóng gói (closure) `ctx` từ chính `apply()` của
 * nó để dùng bên trong `runTurn`: fiber đăng ký driver có thể bị dispose
 * (hot-swap ở Phase 5) trong lúc 1 turn khác còn đang chạy dở với driver đó;
 * nếu closure giữ `ctx` của fiber đã dispose, mọi `ctx.storage`/`ctx.llm`
 * gọi tiếp sau đó sẽ throw "inactive context" — đã verify thực nghiệm.
 * `runCtx` phải đến từ 1 caller ổn định (bundles/agent-runner) và được
 * truyền vào NGAY LÚC GỌI, không phải lúc đăng ký.
 */
export interface LoopDriver {
  runTurn(runCtx: Context, session: Session, input: TurnInput): Promise<LoopTurnResult>
}

export abstract class LoopRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'loop')
  }

  /**
   * Đăng ký 1 loop driver dưới 1 tên. Cùng ràng buộc effect-scoping như
   * ToolRegistryService.add / SubagentRegistryService.register.
   */
  abstract register(name: string, driver: LoopDriver): void
  abstract get(name: string): LoopDriver | undefined
  abstract has(name: string): boolean
}

/**
 * Trạng thái 1 cuộc hội thoại. KHÔNG phải service trên `ctx` — đây là domain
 * object thuần, tạo mới cho mỗi session, không cần spatial composability
 * (nó là dữ liệu, không phải capability của hệ thống).
 *
 * Coding rule B6: `buildPrompt()` là nơi DUY NHẤT ráp prompt — loop driver
 * không tự ráp message rải rác.
 */
export class Session {
  history: LlmMessage[] = []
  private extensions = new Map<string, unknown>()

  constructor(
    public id: string,
    public maxSteps = 8,
    systemPrompt?: string,
    /** Driver mặc định cho session này khi caller không chỉ định riêng (Phase 6: REST/WS không cần truyền driver mỗi request). */
    public driver = 'default',
    /**
     * Phase 8.2 — trần số message giữ trong `history`. Coding rule A14: state
     * sống lâu hơn 1 request phải có giới hạn thật, không phải "lớn mãi".
     * Trim theo message thô (không theo "turn" hoàn chỉnh) — an toàn vì
     * role 'tool' đã bị hạ xuống 'user' có tiền tố khi gửi API thật (xem
     * llm-qwen/llm-deepseek), history gửi lên không có ràng buộc cấu trúc
     * phải giữ nguyên cặp tool_call/tool_result.
     */
    public maxHistoryMessages = 40,
  ) {
    if (systemPrompt) this.history.push({ role: 'system', content: systemPrompt })
  }

  private trimHistory() {
    if (this.history.length <= this.maxHistoryMessages) return
    const hasLeadingSystem = this.history[0]?.role === 'system'
    const budget = this.maxHistoryMessages - (hasLeadingSystem ? 1 : 0)
    const tail = this.history.slice(-Math.max(budget, 0))
    this.history = hasLeadingSystem ? [this.history[0], ...tail] : tail
  }

  /**
   * `extraSystemNotes` (Phase 15, seams/skill.ts): nội dung skill đã match
   * cho ĐÚNG lượt này — chèn làm message role 'system' riêng, ngay sau
   * system prompt gốc (nếu có), TRƯỚC lịch sử hội thoại cũ. KHÔNG ghi vào
   * `this.history` — skill được match lại mỗi lượt dựa trên tin nhắn hiện
   * tại, chèn cố định vào history sẽ lặp lại nội dung này ở mọi lượt sau dù
   * không còn liên quan. Vẫn tuân coding rule B6 (buildPrompt là nơi DUY
   * NHẤT ráp prompt) — loop driver truyền skill đã match vào đây, không tự
   * ráp mảng message rời rạc.
   */
  buildPrompt(userMessage: string, extraSystemNotes: string[] = []): LlmMessage[] {
    this.history.push({ role: 'user', content: userMessage })
    this.trimHistory()
    if (extraSystemNotes.length === 0) return [...this.history]
    const hasLeadingSystem = this.history[0]?.role === 'system'
    const insertAt = hasLeadingSystem ? 1 : 0
    const notes: LlmMessage[] = extraSystemNotes.map((content) => ({ role: 'system', content }))
    return [...this.history.slice(0, insertAt), ...notes, ...this.history.slice(insertAt)]
  }

  recordAssistant(content: string, toolCall?: LlmToolCall) {
    const label = toolCall ? `[tool_call:${toolCall.name}(${JSON.stringify(toolCall.args)})] ` : ''
    this.history.push({ role: 'assistant', content: label + content })
    this.trimHistory()
  }

  recordToolResult(name: string, result: unknown) {
    this.history.push({ role: 'tool', content: `[${name}] ${JSON.stringify(result)}` })
    this.trimHistory()
  }

  /** State có scope theo session của một loop plugin, không làm bẩn contract chung. */
  extension<T>(key: string, create: () => T): T {
    if (!this.extensions.has(key)) this.extensions.set(key, create())
    return this.extensions.get(key) as T
  }
}
