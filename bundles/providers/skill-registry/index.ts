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

// Khoá lưu trữ nội bộ TÁCH khỏi `def.name` (hiển thị/tra cứu) — namespace
// theo owner. Không dùng bare `def.name` làm key Map: 2 user khác nhau đặt
// trùng tên skill (rất dễ xảy ra với tên thông dụng) sẽ ghi đè âm thầm lẫn
// nhau (last-write-wins) nếu chỉ có 1 namespace toàn cục. Skill global
// (ownerId undefined) giữ nguyên namespace cũ để 100% backward-compatible
// với 17+ skill build-time hiện có.
function storageKey(name: string, ownerId?: string): string {
  return ownerId ? `user:${ownerId}:${name}` : `global:${name}`
}

function isVisible(skill: SkillDefinition, visibleTo?: string): boolean {
  if (!skill.ownerId) return true
  return skill.ownerId === visibleTo
}

export class SkillRegistry extends SkillRegistryService {
  private skills = new Map<string, { definition: SkillDefinition; readResource?: SkillResourceReader }>()

  register(def: SkillDefinition, readResource?: SkillResourceReader) {
    this.ctx.effect(() => {
      const key = storageKey(def.name, def.ownerId)
      if (this.skills.has(key)) {
        throw new Error(`skill "${def.name}" already registered`)
      }
      this.skills.set(key, { definition: def, readResource })
      this.ctx.logger('skill-registry').info('registered skill "%s"', def.name)
      return () => {
        this.skills.delete(key)
        this.ctx.logger('skill-registry').info('unregistered skill "%s"', def.name)
      }
    }, `ctx.skills.register(${JSON.stringify(def.name)})`)
  }

  upsert(def: SkillDefinition, readResource?: SkillResourceReader) {
    this.skills.set(storageKey(def.name, def.ownerId), { definition: def, readResource })
    this.ctx.logger('skill-registry').info('upsert skill "%s" (owner=%s)', def.name, def.ownerId ?? 'global')
  }

  remove(name: string, ownerId: string) {
    const deleted = this.skills.delete(storageKey(name, ownerId))
    if (deleted) this.ctx.logger('skill-registry').info('removed skill "%s" (owner=%s)', name, ownerId)
    return deleted
  }

  get(name: string, visibleTo?: string) {
    // Ưu tiên bản riêng của chính caller (nếu có), rồi mới tới bản global —
    // caller không cần biết trước 1 tên là global hay của chính họ.
    const own = visibleTo ? this.skills.get(storageKey(name, visibleTo))?.definition : undefined
    if (own) return own
    const global = this.skills.get(storageKey(name))?.definition
    if (global && isVisible(global, visibleTo)) return global
    return undefined
  }

  has(name: string, ownerId?: string) {
    return this.skills.has(storageKey(name, ownerId))
  }

  list(options: SkillListOptions = {}) {
    const visible = [...this.skills.values()].map((entry) => entry.definition).filter((skill) => {
      if (!isVisible(skill, options.visibleTo)) return false
      if (options.userInvocableOnly && !skill.userInvocable) return false
      return true
    })
    if (!options.visibleTo) return visible
    // Trùng tên (custom skill của user tự đặt trùng tên với 1 skill global
    // build-time) -- 2 namespace lưu trữ khác nhau (storageKey) nên cả 2
    // entry cùng lọt qua filter phía trên. Không dedupe ở đây thì bất kỳ
    // consumer nào tra theo `name` (candidates.find() trong
    // skill-selection-llm, hay JSON catalog gửi cho model) sẽ vớ phải bản
    // global trước -- vì nó luôn được đăng ký sớm hơn trong Map -- trong khi
    // `get()` phía trên đã đúng logic ưu tiên bản riêng của user. Giữ đúng
    // 1 quy tắc ưu tiên xuyên suốt: bản riêng của user LUÔN thắng bản global
    // cùng tên.
    const byName = new Map<string, SkillDefinition>()
    for (const skill of visible) {
      const existing = byName.get(skill.name)
      if (!existing || skill.ownerId === options.visibleTo) byName.set(skill.name, skill)
    }
    return [...byName.values()]
  }

  match(userMessage: string, visibleTo?: string) {
    const haystack = userMessage.normalize('NFKC').toLowerCase()
    return this.list({ visibleTo }).filter((skill) =>
      skill.triggers.some((trigger) => {
        const needle = trigger.normalize('NFKC').trim().toLowerCase()
        if (!needle) return false
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(haystack)
      }),
    )
  }

  async readResource(skillName: string, resourcePath: string, visibleTo?: string) {
    const definition = this.get(skillName, visibleTo)
    if (!definition) throw new Error(`skill "${skillName}" not found`)
    const entry = this.skills.get(storageKey(skillName, definition.ownerId))!
    const resource = definition.resources?.find((item) => item.path === resourcePath)
    if (!resource) throw new Error(`resource "${resourcePath}" not found in skill "${skillName}"`)
    if (!entry.readResource) throw new Error(`skill "${skillName}" has no resource reader`)
    return entry.readResource(resourcePath)
  }
}

export const apply = async (ctx: Context) => {
  await ctx.plugin(SkillRegistry)
}
