// bundles/providers/plugin-inventory — provider cho seam ctx.pluginInventory.
//
// KHÔNG duyệt ctx.registry nội bộ (xem seams/plugin-inventory.ts) — nhận
// thẳng danh sách MountRecord do src/serve.ts thu thập tại từng lệnh
// `root.plugin(...)` (fiber trả về NGAY LẬP TỨC dù có await hay không —
// chỉ resolve khi load xong, không ảnh hưởng việc đọc fiber.state sau này).
// `records` là THAM CHIẾU mảng gốc từ serve.ts, không phải bản copy — các
// bundle mount SAU plugin-inventory (vd. api-rest/api-ws/api-grpc/web-ui)
// vẫn được push thêm vào và hiện đúng trong list() gọi về sau, không cần
// mount plugin-inventory cuối cùng trong thứ tự file.
//
// `fiber.state` type number thay vì import `FiberState` — enum đó khai báo
// `declare const enum` bên trong 1 file .d.ts (@deepseek-ai/cordis/lib/types/
// fiber.d.ts): KHÔNG có runtime value nào được compile ra, import làm value
// sẽ vỡ lúc chạy qua tsx/esbuild (không gộp cả project để inline const enum
// như tsc). dsh tự bản thân cũng né vấn đề y hệt (packages/host/
// plugin-inventory/src/index.ts — tự khai lại FIBER_STATE làm object runtime
// thay vì import enum) — copy đúng số thứ tự tài liệu hoá tại fiber.d.ts:
// PENDING=0, LOADING=1, ACTIVE=2, FAILED=3, DISPOSED=4, UNLOADING=5.
import { Context } from '@deepseek-ai/cordis'
import { PluginInventoryEntry, PluginInventoryService, PluginFiberState } from '../../../seams/plugin-inventory.ts'

export interface MountRecord {
  readonly name: string
  readonly category: PluginInventoryEntry['category']
  /** Fiber thật trả về từ `root.plugin(...)` — chỉ cần field `state`. */
  readonly fiber: { readonly state: number }
}

const STATE_LABEL: Record<number, PluginFiberState> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: 'disposed',
  5: 'unloading',
}

function stateLabel(state: number): PluginFiberState {
  return STATE_LABEL[state] ?? 'pending'
}

export class PluginInventory extends PluginInventoryService {
  constructor(ctx: Context, private records: MountRecord[]) {
    super(ctx)
  }

  list(): PluginInventoryEntry[] {
    return this.records.map((record) => ({
      name: record.name,
      category: record.category,
      state: stateLabel(record.fiber.state),
    }))
  }
}

export const apply = async (ctx: Context, records: MountRecord[]) => {
  await ctx.plugin(PluginInventory, records)
}
