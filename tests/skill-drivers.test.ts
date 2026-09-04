// SkillDefinition.drivers — hai loop có năng lực khác hẳn nhau (loop-rlm có
// sandbox IPython + workspace, default-loop chỉ có web_search/database_query)
// nhưng trước đây nhận CHUNG một catalog, nên default-loop được chào những
// skill bảo nó đọc dataset và chạy pandas — hướng dẫn nó không có cách nào
// làm theo. Cùng lớp lỗi "hứa năng lực không tồn tại" đã vá ở tầng prompt.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as skillFilesystem from '../bundles/providers/skill-filesystem/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolSkill from '../bundles/tools/tool-skill/index.ts'
import { resolveActiveSkills } from '../src/skill-runtime.ts'
import type { SkillDefinition } from '../seams/skill.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

function skill(name: string, extra: Partial<SkillDefinition> = {}): SkillDefinition {
  return { name, description: `${name} desc`, instructions: `${name} how-to`, triggers: [], userInvocable: true, ...extra }
}

async function bootRegistry() {
  const root = new Context()
  root.plugin(skillRegistry)
  await settle()
  return root
}

describe('SkillDefinition.drivers — catalog theo đúng năng lực từng loop', () => {
  it('không khai drivers -> mọi driver đều thấy (tương thích ngược 100%)', async () => {
    const root = await bootRegistry()
    root.skills.register(skill('report-writing'))
    expect(root.skills.list({ driver: 'default' }).map((s) => s.name)).toEqual(['report-writing'])
    expect(root.skills.list({ driver: 'rlm' }).map((s) => s.name)).toEqual(['report-writing'])
    expect(root.skills.list().map((s) => s.name)).toEqual(['report-writing'])
    await root.fiber.dispose()
  })

  it('khai drivers: [rlm] -> default-loop KHÔNG thấy, rlm thấy', async () => {
    const root = await bootRegistry()
    root.skills.register(skill('pandas-expert', { drivers: ['rlm'] }))
    root.skills.register(skill('web-research', { drivers: ['default'] }))
    expect(root.skills.list({ driver: 'default' }).map((s) => s.name)).toEqual(['web-research'])
    expect(root.skills.list({ driver: 'rlm' }).map((s) => s.name)).toEqual(['pandas-expert'])
    // Không truyền driver = liệt kê tất cả (API quản trị).
    expect(root.skills.list().map((s) => s.name).sort()).toEqual(['pandas-expert', 'web-research'])
    await root.fiber.dispose()
  })

  it('match() cũng lọc theo driver — trigger của skill rlm không kích hoạt trong default-loop', async () => {
    const root = await bootRegistry()
    root.skills.register(skill('pandas-expert', { drivers: ['rlm'], triggers: ['dataframe'] }))
    expect(root.skills.match('sửa giúp tôi cái dataframe này', undefined, 'rlm').map((s) => s.name)).toEqual(['pandas-expert'])
    expect(root.skills.match('sửa giúp tôi cái dataframe này', undefined, 'default')).toEqual([])
    await root.fiber.dispose()
  })

  it('chọn tường minh một skill sai driver -> throw, danh sách gợi ý chỉ gồm skill của driver đó', async () => {
    const root = await bootRegistry()
    root.skills.register(skill('pandas-expert', { drivers: ['rlm'] }))
    root.skills.register(skill('web-research', { drivers: ['default'] }))
    expect(() => resolveActiveSkills(root.skills, 'x', 'pandas-expert', undefined, 'default'))
      .toThrow(/available: web-research/)
    // Cùng skill đó chọn trong rlm thì chạy bình thường.
    expect(resolveActiveSkills(root.skills, 'x', 'pandas-expert', undefined, 'rlm')[0].skill.name).toBe('pandas-expert')
    await root.fiber.dispose()
  })

  it('loader đọc `drivers:` trong frontmatter SKILL.md', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'skill-drivers-'))
    mkdirSync(path.join(dir, 'only-rlm'))
    writeFileSync(path.join(dir, 'only-rlm', 'SKILL.md'), '---\nname: only-rlm\ndescription: d\ndrivers: rlm\n---\nbody\n')
    mkdirSync(path.join(dir, 'both'))
    writeFileSync(path.join(dir, 'both', 'SKILL.md'), '---\nname: both\ndescription: d\n---\nbody\n')

    const root = new Context()
    root.plugin(skillRegistry)
    root.plugin(skillFilesystem, { root: dir })
    await settle()
    expect(root.skills.list({ driver: 'default' }).map((s) => s.name)).toEqual(['both'])
    expect(root.skills.list({ driver: 'rlm' }).map((s) => s.name).sort()).toEqual(['both', 'only-rlm'])
    await root.fiber.dispose()
  })

  it('tool `skill`: model trong default-loop đoán bừa tên skill rlm-only -> không nạp được', async () => {
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(toolSkill)
    await settle()
    root.skills.register(skill('pandas-expert', { drivers: ['rlm'] }))
    root.skills.register(skill('web-research', { drivers: ['default'] }))

    const tool = root.tools.get('skill')!
    await expect(tool.handler({ name: 'pandas-expert' }, { sessionId: 's1', source: 'default-loop' }))
      .rejects.toThrow(/not found; available: web-research/)
    // Cùng lời gọi đó từ worker RLM thì nạp được.
    const loaded = await tool.handler({ name: 'pandas-expert' }, { sessionId: 's2', source: 'rlm' }) as { name: string }
    expect(loaded.name).toBe('pandas-expert')
    await root.fiber.dispose()
  })
})
