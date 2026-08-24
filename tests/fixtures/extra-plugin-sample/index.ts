// tests/fixtures/extra-plugin-sample/index.ts — plugin "bên thứ ba" mẫu
// dùng bởi tests/extra-plugins.test.ts — chỉ để xác nhận EXTRA_PLUGINS thật
// sự nạp được 1 module bên NGOÀI src/serve.ts, đúng contract chuẩn (giống
// hệt mọi bundle nội bộ, không có API riêng nào phải học thêm — xem
// docs/agent-core-adding-plugins.md).
import { Context } from '@deepseek-ai/cordis'

export const inject = ['tools']

export const apply = async (ctx: Context, config?: { greeting?: string }) => {
  ctx.tools.add({
    name: 'extra_plugin_sample_tool',
    description: 'Fixture tool for tests/extra-plugins.test.ts',
    async handler() {
      return { message: `${config?.greeting ?? 'hello'} from extra plugin` }
    },
  })
}
