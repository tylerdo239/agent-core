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

// Merge RLM harness (xem docs/agent-core-rate-limit-and-security-audit.md
// Finding A1 + docs/agent-core-rlm-harness-merge-plan.md mục 3.2/7.3): bản
// gốc RLM thêm `ToolInvocationContext` (sessionId/source) qua `invoke()`
// nhưng KHÔNG truyền xuống handler -- tool nào tự đọc `sessionId` từ
// `args` (model tự cho) thay vì context CHỦ ĐỘNG bị đọc BẤT KỲ session nào,
// không phải giả thuyết (xem tool-database-query, đã sửa cùng lúc với thay
// đổi này). `context` bắt buộc (không optional) -- mọi lời gọi tool ĐỀU đi
// qua `ToolRegistryService.invoke()`, không còn cách nào gọi handler mà
// thiếu context.
export type ToolHandler = (args: Record<string, unknown>, context: ToolInvocationContext) => Promise<unknown>

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

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema mô tả tham số — dùng để quảng bá cho model qua LlmToolSpec (xem seams/llm.ts). */
  parameters?: Record<string, unknown>
  handler: ToolHandler
  ui?: ToolUiHint
}

export interface ToolInvocationContext {
  sessionId: string
  source: 'default-loop' | 'planner-critic' | 'rlm' | 'subagent'
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
