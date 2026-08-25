// packages/ui-slots/src/tool-view.ts — Phase 9.4/9.5: hợp đồng props cho
// slot cụ thể 'tool.call.toolview' (apps/web dựng owner, UI-plugin của tool
// nhận owner) — KHÔNG phải phần lõi generic của SlotCore (core.ts không biết
// gì về "tool call", chỉ là data structure thuần).
//
// Định nghĩa lại `toolCall` cục bộ (không import type từ seams/llm.ts phía
// server) để giữ đúng tinh thần "framework-agnostic" của package này — không
// tạo phụ thuộc ngầm vào cấu trúc file phía server, dù chỉ là type-only.
export interface ToolViewOwnerProps {
  toolCall: { name: string; args: Record<string, unknown> }
  /** `undefined` khi state = 'running' (tool chưa chạy xong). */
  result: unknown
  state: 'running' | 'ok' | 'error'
  /**
   * `ToolDefinition.ui` (Phase 8.5) forward qua `LoopStep.toolUi` — component
   * riêng của tool thường không cần field này (đã biết icon/label/cách hiển
   * thị của chính nó), nhưng `GenericToolCard` (fallback bắt buộc, Phase 9.4)
   * cần để hiển thị hợp lý khi tool không có UI-plugin riêng.
   */
  toolUi?: { icon?: string; label?: string; render?: 'citations' | 'io'; summaryArg?: string }
}
