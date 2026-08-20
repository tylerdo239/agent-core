// packages/ui-slots/src/seam.ts — Phase 9.2: bọc SlotCore (9.1, framework-
// agnostic) thành seam Cordis `ctx.slots` cho CÂY CONTEXT RIÊNG chạy trong
// trình duyệt (apps/web, Phase 9.4) — không liên quan cây `root` server-side
// của src/serve.ts.
//
// Cùng pattern seam-first đã dùng xuyên suốt phía server (seams/*.ts định
// nghĩa abstract Service, bundles/providers/* implement) — gộp cả 2 vào 1
// file ở đây vì packages/ui-slots là 1 package độc lập nhỏ, không có khái
// niệm "nhiều provider thay thế nhau" cho seam này (chỉ có đúng 1
// SlotRegistry, không giống ctx.llm có nhiều provider để chọn).
import { Context, Service } from '@deepseek-ai/cordis'
import { SlotCore, SlotEntry, SlotKind } from './core.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotRegistryService
  }
}

export abstract class SlotRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  abstract declare(name: string, kind: SlotKind): void

  /**
   * Đăng ký 1 entry vào slot. Disposer trả về PHẢI được gắn qua `ctx.effect()`
   * bởi NGƯỜI GỌI (UI-plugin) — đúng pattern `ToolRegistryService.add`/
   * `LoopRegistryService.register` đã có ở phía server (coding rule A2), để
   * entry tự rút khi fiber của UI-plugin unload (coding rule A15).
   */
  abstract register<P>(name: string, entry: SlotEntry<P>): () => void
  abstract entries(name: string): readonly SlotEntry[]
  abstract subscribe(name: string, fn: () => void): () => void
}

export class SlotRegistry extends SlotRegistryService {
  private core = new SlotCore()

  declare(name: string, kind: SlotKind) {
    this.core.declare(name, kind)
  }

  register<P>(name: string, entry: SlotEntry<P>) {
    return this.core.register(name, entry)
  }

  entries(name: string) {
    return this.core.entries(name)
  }

  subscribe(name: string, fn: () => void) {
    return this.core.subscribe(name, fn)
  }
}

export const apply = async (ctx: Context) => {
  await ctx.plugin(SlotRegistry)
}
