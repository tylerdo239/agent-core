// bundles/skill-registry — provider cho seam ctx.skills.
//
// Cùng pattern effect-scoping với bundles/tool-registry (xem comment gốc ở
// đó): `register()` gắn effect qua `this.ctx.effect()`, `this.ctx` bên trong
// method của instance resolve về context của FIBER ĐANG GỌI
// `ctx.skills.register(...)`, không phải fiber tạo ra SkillRegistry — nên 1
// skill tự gỡ khi fiber đăng ký nó unload, tự đăng ký lại khi fiber đó
// active lại, đúng spatial composability không cần code thủ công thêm.
import { Context } from '@deepseek-ai/cordis'
import { SkillDefinition, SkillRegistryService } from '../../../seams/skill.ts'

export class SkillRegistry extends SkillRegistryService {
  private skills = new Map<string, SkillDefinition>()

  register(def: SkillDefinition) {
    this.ctx.effect(() => {
      if (this.skills.has(def.name)) {
        throw new Error(`skill "${def.name}" already registered`)
      }
      this.skills.set(def.name, def)
      this.ctx.logger('skill-registry').info('registered skill "%s"', def.name)
      return () => {
        this.skills.delete(def.name)
        this.ctx.logger('skill-registry').info('unregistered skill "%s"', def.name)
      }
    }, `ctx.skills.register(${JSON.stringify(def.name)})`)
  }

  get(name: string) {
    return this.skills.get(name)
  }

  has(name: string) {
    return this.skills.has(name)
  }

  list() {
    return [...this.skills.values()]
  }

  match(userMessage: string) {
    const haystack = userMessage.toLowerCase()
    return this.list().filter((skill) =>
      skill.triggers.some((trigger) => haystack.includes(trigger.toLowerCase())),
    )
  }
}

export const apply = async (ctx: Context) => {
  await ctx.plugin(SkillRegistry)
}
