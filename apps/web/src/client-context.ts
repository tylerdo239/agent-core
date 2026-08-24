// apps/web/src/client-context.ts — Phase 9.4/9.5: CÂY CORDIS RIÊNG chạy
// trong TRÌNH DUYỆT — không liên quan cây `root` server-side của
// src/serve.ts. Mount `ui-slots` + toàn bộ UI-plugin của tool — TƯỜNG MINH,
// liệt kê rõ từng cái, không auto-discover qua quét thư mục (coding rule
// A16, nhất quán với cách src/serve.ts mount bundle phía server).
//
// PHẢI async: verify thực nghiệm `ctx.plugin(uiSlots)` KHÔNG làm `ctx.slots`
// sẵn sàng đồng bộ ngay sau lệnh gọi (apply của seam là `async`, `await
// ctx.plugin(SlotRegistry)` bên trong nó resolve ở 1 microtask sau) — gọi
// `ctx.slots.declare(...)` ngay sau `ctx.plugin(uiSlots)` mà không await
// throw `Cannot read properties of undefined (reading 'declare')`. Phải
// `await fiber.await()` trước (đúng pattern A13/A7 đã dùng xuyên suốt phía
// server, giờ áp dụng cả client-side) — await MỌI fiber mount ở đây, kể cả
// khi `apply` trông có vẻ đồng bộ, để không lặp lại đúng lớp bug này.
import { Context } from '@deepseek-ai/cordis'
import * as uiSlots from '@agent-core/ui-slots'
import * as uiToolWebSearch from '@agent-core/ui-tool-web-search'
import * as uiRlmWorkspace from '@agent-core/ui-rlm-workspace'

export async function createClientContext(): Promise<Context> {
  const ctx = new Context()

  const slotsFiber = ctx.plugin(uiSlots)
  await slotsFiber.await()
  ctx.slots.declare('tool.call.toolview', 'keyed')
  // docs/agent-core-rlm-web-ui-plugin-plan.md mục 1 — chrome của cả phiên
  // (workspace bar/skill-select), key = tên loop driver. Session
  // 'default'/'planner-critic' không có registrant khớp -> App.tsx tự rơi
  // về fallback null qua RenderSlot, không hiện gì (khác 'tool.call.toolview'
  // ở trên, phạm vi hẹp hơn: 1 tool-call cụ thể, không phải cả chrome phiên).
  ctx.slots.declare('session.chrome.header', 'keyed')
  ctx.slots.declare('session.chrome.composer', 'keyed')

  // Phase 9.5: `tool-web-search` có UI-plugin riêng thật (WebSearchCard, có
  // state cục bộ + hành động "mở tất cả" — khác biệt VỀ LOẠI so với
  // GenericToolCard). `tool-database-query` CHỦ ĐỘNG không có UI-plugin
  // riêng — chứng minh đường fallback GenericToolCard hoạt động đúng cho
  // tool không đăng ký gì (đa số tool tương lai), không phải thiếu sót.
  const webSearchFiber = ctx.plugin(uiToolWebSearch)
  await webSearchFiber.await()

  // docs/agent-core-rlm-web-ui-plugin-plan.md — workspace bar/skill-select
  // của RLM, tách khỏi App.tsx, đăng ký key 'rlm' vào 2 slot khai ở trên.
  const rlmWorkspaceFiber = ctx.plugin(uiRlmWorkspace)
  await rlmWorkspaceFiber.await()

  return ctx
}
