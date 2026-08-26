// bundles/skill-registry — provider cho seam ctx.skills.
//
// Cùng pattern effect-scoping với bundles/tool-registry (xem comment gốc ở
// đó): `register()` gắn effect qua `this.ctx.effect()`, `this.ctx` bên trong
// method của instance resolve về context của FIBER ĐANG GỌI
// `ctx.skills.register(...)`, không phải fiber tạo ra SkillRegistry — nên 1
// skill tự gỡ khi fiber đăng ký nó unload, tự đăng ký lại khi fiber đó
// active lại, đúng spatial composability không cần code thủ công thêm.
import { Context } from '@deepseek-ai/cordis'
import { SkillDefinition, SkillListOptions, SkillRegistryService, SkillResourceReader } from '../../../seams/skill.ts'

export class SkillRegistry extends SkillRegistryService {
  private skills = new Map<string, { definition: SkillDefinition; readResource?: SkillResourceReader }>()

  register(def: SkillDefinition, readResource?: SkillResourceReader) {
    this.ctx.effect(() => {
      if (this.skills.has(def.name)) {
        throw new Error(`skill "${def.name}" already registered`)
      }
      this.skills.set(def.name, { definition: def, readResource })
      this.ctx.logger('skill-registry').info('registered skill "%s"', def.name)
      return () => {
        this.skills.delete(def.name)
        this.ctx.logger('skill-registry').info('unregistered skill "%s"', def.name)
      }
    }, `ctx.skills.register(${JSON.stringify(def.name)})`)
  }

  get(name: string) {
    return this.skills.get(name)?.definition
  }

  has(name: string) {
    return this.skills.has(name)
  }

  list(options: SkillListOptions = {}) {
    return [...this.skills.values()].map((entry) => entry.definition).filter((skill) => {
      if (options.userInvocableOnly && !skill.userInvocable) return false
      return true
    })
  }

  match(userMessage: string) {
    const haystack = userMessage.normalize('NFKC').toLowerCase()
    return this.list().filter((skill) =>
      skill.triggers.some((trigger) => {
        const needle = trigger.normalize('NFKC').trim().toLowerCase()
        if (!needle) return false
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(haystack)
      }),
    )
  }

  async readResource(skillName: string, resourcePath: string) {
    const entry = this.skills.get(skillName)
    if (!entry) throw new Error(`skill "${skillName}" not found`)
    const resource = entry.definition.resources?.find((item) => item.path === resourcePath)
    if (!resource) throw new Error(`resource "${resourcePath}" not found in skill "${skillName}"`)
    if (!entry.readResource) throw new Error(`skill "${skillName}" has no resource reader`)
    return entry.readResource(resourcePath)
  }
}

export const apply = async (ctx: Context) => {
  await ctx.plugin(SkillRegistry)
}
