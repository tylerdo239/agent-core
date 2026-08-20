// Phase 15 deliverable: seam ctx.skills — register/get/has/list/match thật,
// và spatial composability (skill tự suspend/resume theo fiber đăng ký nó),
// cùng kỷ luật test đã áp dụng cho tool-registry/subagent-manager (xem
// tests/spatial-composability.test.ts).
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as skillSupportTone from '../bundles/skills/skill-support-tone/index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('skill-registry — register/get/has/list', () => {
  it('register() rồi get()/has()/list() thấy đúng skill', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    await settle()

    root.skills.register({
      name: 'demo',
      description: 'demo skill',
      triggers: ['demo'],
      instructions: 'nội dung demo',
    })

    expect(root.skills.has('demo')).toBe(true)
    expect(root.skills.get('demo')?.instructions).toBe('nội dung demo')
    expect(root.skills.list().map((s) => s.name)).toEqual(['demo'])
  })

  it('register() 2 lần cùng tên -> throw "already registered"', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    await settle()

    root.skills.register({ name: 'dup', description: '', triggers: [], instructions: 'x' })
    expect(() => root.skills.register({ name: 'dup', description: '', triggers: [], instructions: 'y' })).toThrow(
      'skill "dup" already registered',
    )
  })
})

describe('skill-registry — match()', () => {
  it('khớp trigger dạng substring, KHÔNG phân biệt hoa/thường', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    root.plugin(skillSupportTone)
    await settle()

    expect(root.skills.match('Tôi muốn KHIẾU NẠI về dịch vụ').map((s) => s.name)).toEqual(['support-tone'])
    expect(root.skills.match('mạng nhà tôi báo lỗi mạng liên tục').map((s) => s.name)).toEqual(['support-tone'])
  })

  it('không khớp trigger nào -> mảng rỗng', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    root.plugin(skillSupportTone)
    await settle()

    expect(root.skills.match('hôm nay thời tiết thế nào')).toEqual([])
  })

  it('skill không có trigger nào (rỗng) -> không bao giờ tự match', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    await settle()

    root.skills.register({ name: 'silent', description: '', triggers: [], instructions: 'x' })
    expect(root.skills.match('bất kỳ nội dung gì, kể cả rỗng')).toEqual([])
    expect(root.skills.match('')).toEqual([])
  })
})

describe('spatial composability — skill ↔ skill-registry', () => {
  it('skill tự suspend khi skill-registry bị gỡ, tự resume khi quay lại', async () => {
    const root = new Context()
    const registryFork = root.plugin(skillRegistry)
    root.plugin(skillSupportTone)
    await settle()

    expect(root.skills.has('support-tone')).toBe(true)

    await registryFork.dispose()
    await settle()
    expect(root.skills).toBeUndefined() // registry chính bị gỡ -> ctx.skills không còn

    root.plugin(skillRegistry)
    await settle()
    expect(root.skills.has('support-tone')).toBe(true) // skill-support-tone tự đăng ký lại
  })
})
