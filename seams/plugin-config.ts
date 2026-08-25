// seams/plugin-config.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/providers/plugin-config-postgres.
//
// Key-value đơn giản để plugin (tool/provider) đọc cấu hình runtime-editable
// từ admin qua UI (vd. serperApiKey — xem bundles/tools/tool-web-search),
// KHÔNG cần restart service. Khác `.env`: giá trị đổi được ngay lúc chạy,
// lưu Postgres (cùng DATABASE_URL đã bắt buộc cho ctx.auth, không thêm biến
// môi trường bắt buộc mới).
//
// Cố tình KHÔNG có "catalog" các key hợp lệ ở tầng seam này — plugin nào cần
// 1 key tự đọc đúng tên key của mình (`ctx.pluginConfig.get('serperApiKey')`),
// danh sách hiển thị cho admin (tên/nhãn/mô tả) sống ở tầng UI
// (packages/ui-plugin-settings), seam này chỉ là kho lưu trữ thuần, không
// biết gì về ý nghĩa từng key — giữ đúng seam-first, không ép seam phải biết
// trước mọi plugin tương lai sẽ dùng key nào (coding rule A6).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginConfig: PluginConfigService
  }
}

export abstract class PluginConfigService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'pluginConfig')
  }

  /** `undefined` khi key chưa được cấu hình — KHÔNG throw. */
  abstract get(key: string): Promise<string | undefined>

  /** Ghi đè giá trị (upsert) — value rỗng vẫn được lưu nguyên văn, dùng `delete()` để xoá hẳn. */
  abstract set(key: string, value: string): Promise<void>

  abstract delete(key: string): Promise<void>

  /** Danh sách key ĐANG có giá trị lưu — KHÔNG trả giá trị thật (secret không được rời DB qua đường này). */
  abstract listConfiguredKeys(): Promise<string[]>
}
