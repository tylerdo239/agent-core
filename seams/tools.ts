// seams/tools.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/tool-registry.
//
// Lưu ý: khác với dsh, `ctx.tools` KHÔNG có sẵn từ framework Cordis — đây là
// seam nghiệp vụ do agent-core tự định nghĩa (xem cảnh báo ở cuối build plan).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: ToolRegistryService
  }
}

export class ToolExecutionError extends Error {
  constructor(
    public readonly code: 'TOOL_NOT_FOUND' | 'TOOL_ARGS_INVALID' | 'TOOL_PERMISSION_DENIED' | 'TOOL_TIMEOUT' | 'TOOL_CANCELLED' | 'TOOL_HANDLER_ERROR',
    message: string,
    public readonly tool?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ToolExecutionError'
  }
}

/**
 * Phase 8.5 — metadata hiển thị THUẦN (không phải logic nghiệp vụ), để
 * `web-ui` render tool call/kết quả mà không cần biết tên tool cụ thể nào
 * (trước đó `app.js` hardcode `if (name === 'web_search')` — vi phạm
 * seam-first). Tool không khai `ui` thì UI dùng fallback chung (icon 🔧,
 * label = tên tool, render 'io').
 */
export interface ToolUiHint {
  icon?: string
  label?: string
  /** 'citations' = danh sách nguồn đánh số (web search...). 'io' (mặc định) = card IN/OUT chung. */
  render?: 'citations' | 'io'
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema mô tả tham số — dùng để quảng bá cho model qua LlmToolSpec (xem seams/llm.ts). */
  parameters?: Record<string, unknown>
  handler: (args: Record<string, unknown>, context?: ToolInvocationContext) => Promise<unknown>
  ui?: ToolUiHint
  permissionActor?: string
  permissionAction?: string
  timeoutMs?: number
  version?: string
}

export interface ToolInvocationContext {
  sessionId: string
  source: 'default-loop' | 'planner-critic' | 'rlm' | 'subagent' | 'pipeline' | 'api'
  principal?: string
  runId?: string
  jobId?: string
  deadline?: number
  signal?: AbortSignal
}

export abstract class ToolRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  /**
   * Đăng ký 1 tool. Disposer trả về PHẢI được gắn qua `ctx.effect()` bên
   * trong implementation, để tool tự gỡ khi fiber của CALLER (không phải
   * fiber của ToolRegistryService) unload — đây là điều kiện để spatial
   * composability hoạt động đúng (xem coding rule A2).
   */
  abstract add(def: ToolDefinition): void
  abstract get(name: string): ToolDefinition | undefined
  abstract has(name: string): boolean
  abstract list(): ToolDefinition[]
  /** Điểm execution duy nhất cho mọi loop/runtime bridge. */
  abstract invoke(
    name: string,
    args: Record<string, unknown>,
    context: ToolInvocationContext,
  ): Promise<unknown>
}
