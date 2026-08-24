// seams/plugin-inventory.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/providers/plugin-inventory.
//
// Tham khảo dsh (packages/host/plugin-inventory — PluginInventoryGateway):
// đọc trực tiếp Loader tại thời điểm gọi, không cache, không lịch sử/mutation
// — cùng triết lý "point-in-time" ở đây. KHÁC dsh: agent-core không dùng
// @deepseek-ai/cordis-plugin-loader (không có ctx.loader — mount tất cả qua
// `root.plugin(...)` tường minh trong src/serve.ts, đúng coding rule A16
// "explicit mounting, no auto-scan"), nên seam này không đọc Loader mà đọc
// list Fiber do chính src/serve.ts thu thập lúc mount (xem MountRecord ở
// provider) — chính xác 100% với những gì THẬT SỰ được mount, thay vì suy
// đoán qua tên hàm/class nội bộ (nhiều bundle không tự tạo class/Service
// riêng, sẽ không hiện tên hữu ích nếu duyệt thẳng ctx.registry).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginInventory: PluginInventoryService
  }
}

/** Nhãn trạng thái Fiber — cùng tập giá trị FiberState của Cordis core. */
export type PluginFiberState = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | 'disposed'

/** Một bundle đã mount trong src/serve.ts, khớp cấu trúc thư mục bundles/.
 * `'external'` — plugin bên thứ ba nạp qua EXTRA_PLUGINS (docs/agent-core-
 * adding-plugins.md), không thuộc cấu trúc bundles/ nội bộ nào ở trên. */
export interface PluginInventoryEntry {
  readonly name: string
  readonly category: 'provider' | 'tool' | 'skill' | 'loop-driver' | 'prompt' | 'adapter' | 'pipeline-stage' | 'pipeline' | 'external'
  readonly state: PluginFiberState
}

export abstract class PluginInventoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /** Snapshot hiện tại — đọc trực tiếp Fiber.state mỗi lần gọi, không cache. */
  abstract list(): PluginInventoryEntry[]
}
