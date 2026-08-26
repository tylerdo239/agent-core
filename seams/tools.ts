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
  /**
   * Tên field trong `args` dùng làm tóm tắt NGƯỜI ĐỌC ĐƯỢC lúc tool đang
   * chạy (vd. 'query' cho web_search -> hiện `"<câu tìm>"` thay vì raw JSON
   * `{"query":"..."}`). So sánh dsh (`WebBlock`)/Claude — cả 2 đều hiện
   * NGAY câu tìm kiếm thật lúc đang chạy, không phải tham số kỹ thuật thô.
   * Không khai field này -> UI fallback về JSON.stringify(args) như cũ.
   */
  summaryArg?: string
}

/**
 * Follow-up (2026-08) — third-party extensibility: trước đây danh sách
 * "plugin nào cấu hình được qua UI admin" nằm CỨNG trong
 * packages/ui-plugin-settings (1 mảng CATALOG hardcode), nghĩa là 1 tool
 * bên thứ 3 nạp qua EXTRA_PLUGINS (docs/agent-core-adding-plugins.md) dù tự
 * `ctx.tools.add()` được cũng KHÔNG CÓ CÁCH NÀO xuất hiện trong UI cấu hình
 * — phá đúng lời hứa "third-party không cần sửa source lõi". Sửa bằng cách
 * cho tool TỰ khai field cấu hình của chính nó ngay tại đây (cùng chỗ khai
 * `ui: ToolUiHint` — tool tự mô tả UI của mình đã là pattern có sẵn), thay
 * vì danh sách tĩnh tách rời. Chỉ áp dụng cho tool (không phải mọi Service
 * Cordis nói chung) vì đó là nhu cầu THẬT hiện tại (tool-web-search.
 * serperApiKey) — coding rule A6, không xây trước nhu cầu chưa có (vd.
 * provider cần config qua UI thì mở rộng seam này khi thật sự cần, không
 * làm trước).
 */
export interface ToolConfigField {
  /** Key dùng với `ctx.pluginConfig.get/set/delete` (seams/plugin-config.ts). */
  key: string
  label: string
  description: string
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema mô tả tham số — dùng để quảng bá cho model qua LlmToolSpec (xem seams/llm.ts). */
  parameters?: Record<string, unknown>
  handler: ToolHandler
  ui?: ToolUiHint
  permissionActor?: string
  permissionAction?: string
  timeoutMs?: number
  version?: string
  /** Field nào trong `ctx.pluginConfig` tool này đọc — admin cấu hình được
   * qua UI (packages/ui-plugin-settings) nếu khai ở đây. Không khai -> tool
   * không xuất hiện trong danh sách cấu hình (không phải mọi tool đều cần
   * secret runtime-editable). */
  configSchema?: ToolConfigField[]
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

export type ToolHandler = (args: Record<string, unknown>, context: ToolInvocationContext) => Promise<unknown>

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
