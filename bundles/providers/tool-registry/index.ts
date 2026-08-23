// bundles/tool-registry — provider cho seam ctx.tools.
//
// Điểm mấu chốt (coding rule A2 + Phase 3): `add()` gắn effect qua
// `this.ctx.effect()`. Vì Service (không noShadow) được gọi qua proxy có
// "shadow" tracing, `this.ctx` bên trong method của instance này resolve về
// context của FIBER ĐANG GỌI `ctx.tools.add(...)`, không phải fiber đã tạo
// ra ToolRegistry — đã verify thực nghiệm bằng script riêng trước khi build.
// Nhờ vậy: tool tự gỡ đăng ký khi fiber gọi nó unload (vd. vì mất
// dependency), và tự đăng ký lại khi fiber đó active lại — đúng spatial
// composability, không cần code thủ công nào khác ở phía tool.
import { Context } from '@deepseek-ai/cordis'
import { ToolDefinition, ToolInvocationContext, ToolRegistryService } from '../../../seams/tools.ts'

export class ToolRegistry extends ToolRegistryService {
  private tools = new Map<string, ToolDefinition>()

  add(def: ToolDefinition) {
    this.ctx.effect(() => {
      if (this.tools.has(def.name)) {
        throw new Error(`tool "${def.name}" already registered`)
      }
      this.tools.set(def.name, def)
      this.ctx.logger('tool-registry').info('registered tool "%s"', def.name)
      return () => {
        this.tools.delete(def.name)
        this.ctx.logger('tool-registry').info('unregistered tool "%s"', def.name)
      }
    }, `ctx.tools.add(${JSON.stringify(def.name)})`)
  }

  get(name: string) {
    return this.tools.get(name)
  }

  has(name: string) {
    return this.tools.has(name)
  }

  list() {
    return [...this.tools.values()]
  }

  // Finding A1 (docs/agent-core-rate-limit-and-security-audit.md) fix:
  // `context` PHẢI truyền xuống handler -- bản gốc RLM nhận rồi bỏ, khiến
  // tool không có cách nào biết session/nguồn gọi thật, phải tin dữ liệu
  // model tự cho trong `args` (query_database từng đọc args.sessionId --
  // đọc được transcript BẤT KỲ session nào, xem tool-database-query).
  async invoke(name: string, args: Record<string, unknown>, context: ToolInvocationContext) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`tool "${name}" not found`)
    return tool.handler(args, context)
  }
}

export const apply = async (ctx: Context) => {
  await ctx.plugin(ToolRegistry)
}
