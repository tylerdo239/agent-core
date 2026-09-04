// Exhaustive: Session + skill-runtime + skill-registry + prompt-registry + environment-note.
// Mỗi module: rỗng / whitespace / unicode / dài / malformed / trùng / biên / kết nối.
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as promptRegistry from '../bundles/prompts/prompt-default-agent/index.ts'
import * as promptReg from '../bundles/providers/prompt-registry/index.ts'
import { Session } from '../seams/loop.ts'
import { resolveActiveSkills, skillCatalogGuidance, buildSkillRouterQuery } from '../src/skill-runtime.ts'
import { environmentNote, injectEnvironmentNote } from '../src/environment-note.ts'

const settle = () => new Promise((r) => setTimeout(r, 10))

describe('S1 Session exhaustive', () => {
  it('constructor mặc định: maxSteps=25, maxHistoryMessages=40, driver=default', () => {
    const s = new Session('x')
    expect(s.maxSteps).toBe(25); expect(s.maxHistoryMessages).toBe(40); expect(s.driver).toBe('default')
    expect(s.createdAt).toBeLessThanOrEqual(Date.now())
  })
  it('systemPrompt rỗng/undefined -> history rỗng, không push system rác', () => {
    expect(new Session('a', 8, '').history).toHaveLength(0)
    expect(new Session('b', 8, undefined).history).toHaveLength(0)
  })
  it('systemPrompt whitespace-only -> vẫn push (giữ nguyên, không trim ngầm)', () => {
    const s = new Session('c', 8, '   ')
    expect(s.history).toHaveLength(1)
  })
  it('buildPrompt message chỉ whitespace/newline/emoji/unicode NFKC', () => {
    for (const m of ['   ', '\n\n\t', '😀🎉中文العربية', 'ｆｕｌｌｗｉｄｔｈ']) {
      const s = new Session('u')
      const msgs = s.buildPrompt(m)
      expect(msgs.at(-1)!.content).toBe(m)
    }
  })
  it('buildPrompt nhiều lượt liên tiếp -> history tăng đơn điệu, trim đúng trần', () => {
    const s = new Session('seq', 25, undefined, 'default', 6)
    for (let i = 0; i < 10; i++) s.buildPrompt(`msg ${i}`)
    expect(s.history.length).toBeLessThanOrEqual(6)
    expect(s.history.at(-1)!.content).toBe('msg 9')
  })
  it('system leading được giữ khi trim (không bao giờ mất system gốc)', () => {
    const s = new Session('sys', 25, 'SYS', 'default', 4)
    for (let i = 0; i < 10; i++) s.buildPrompt(`m${i}`)
    expect(s.history[0]).toMatchObject({ role: 'system', content: 'SYS' })
  })
  it('không có system leading -> trim lấy đúng tail', () => {
    const s = new Session('nosys', 25, undefined, 'default', 3)
    for (let i = 0; i < 8; i++) s.buildPrompt(`m${i}`)
    expect(s.history).toHaveLength(3)
  })
  it('currentPrompt không append user 2 lần (rebuild sau tool)', () => {
    const s = new Session('cur')
    s.buildPrompt('hello')
    const n1 = s.history.length
    s.currentPrompt(); s.currentPrompt()
    expect(s.history.length).toBe(n1)
  })
  it('extraSystemNotes chứa ""/undefined-ish -> filter sạch, không dòng trống thừa', () => {
    const s = new Session('f', 8, undefined)
    const msgs = s.buildPrompt('hi', ['', 'note'])
    expect(msgs[0].content).not.toContain('\n\n\n')
  })
  it('recordAssistant content rỗng + toolCall rỗng args', () => {
    const s = new Session('ra')
    s.recordAssistant('', { name: 't', args: {} })
    expect(s.history.at(-1)!.content).toContain('[tool_call:t({})]')
  })
  it('recordAssistant content rất dài (500k) -> lưu nguyên, trim sau', () => {
    const s = new Session('rl', 25, undefined, 'default', 4)
    s.recordAssistant('z'.repeat(500_000))
    expect(s.history.at(-1)!.content.length).toBe(500_000)
  })
  it('recordToolResult với undefined/null/số/mảng/circular-safe?', () => {
    const s = new Session('rt')
    for (const v of [undefined, null, 0, 's', [1, 2], { a: { b: 1 } }]) {
      expect(() => s.recordToolResult('t', v)).not.toThrow()
    }
    expect(s.history.filter((m) => m.role === 'tool')).toHaveLength(6)
  })
  it('replaceHistory rỗng -> xoá sạch; thay dài -> trim', () => {
    const s = new Session('rh', 25, undefined, 'default', 3)
    s.buildPrompt('a'); s.replaceHistory([])
    expect(s.history).toHaveLength(0)
    s.replaceHistory([1, 2, 3, 4, 5].map((i) => ({ role: 'user' as const, content: `m${i}` })))
    expect(s.history.length).toBeLessThanOrEqual(3)
  })
  it('extension keys khác nhau độc lập; create lazy đúng 1 lần', () => {
    const s = new Session('ex')
    let n = 0
    const a = s.extension('a', () => (++n, { v: 1 }))
    const b = s.extension('b', () => (++n, { v: 2 }))
    expect(a).not.toBe(b); expect(n).toBe(2)
    expect(s.extension('a', () => (++n, { v: 9 }))).toBe(a); expect(n).toBe(2)
  })
  it('manageHistoryByTokenCompaction tắt hard-trim (giao cho compactor)', () => {
    const s = new Session('tc', 25, undefined, 'default', 2)
    s.manageHistoryByTokenCompaction()
    for (let i = 0; i < 10; i++) s.buildPrompt(`m${i}`)
    expect(s.history.length).toBeGreaterThan(2)
  })
  it('workspaceId: project-first, legacy fallback session.id', () => {
    expect(new Session('s1', 8, undefined, 'default', 40, undefined, 'p1').workspaceId).toBe('project:p1')
    expect(new Session('s2').workspaceId).toBe('s2')
  })
  it('ownerId phân biệt session, không lẫn vào history', () => {
    const s = new Session('o', 8, undefined, 'default', 40, 'u1')
    s.buildPrompt('hi')
    expect(s.history.every((m) => !m.content.includes('u1'))).toBe(true)
  })
  it('maxSteps=0/âm -> constructor giữ nguyên (loop sẽ NO_PROGRESS ngay)', () => {
    expect(new Session('z', 0).maxSteps).toBe(0)
    expect(new Session('n', -5).maxSteps).toBe(-5)
  })
})

describe('S2 resolveActiveSkills + skill-registry exhaustive', () => {
  async function boot() { const r = new Context(); r.plugin(skillRegistry); await settle(); return r }
  it('registry rỗng + mọi input -> []', async () => {
    const r = await boot()
    for (const m of ['', '   ', 'bất kỳ', 'x'.repeat(5000)]) {
      expect(resolveActiveSkills(r.skills, m, undefined)).toEqual([])
    }
    await r.fiber.dispose()
  })
  it('selectedSkill="" (falsy) -> rơi về match, không throw', async () => {
    const r = await boot()
    r.skills.register({ name: 'a', description: 'd', instructions: 'i', triggers: ['hello'], userInvocable: true })
    expect(() => resolveActiveSkills(r.skills, 'hello', '')).not.toThrow()
    await r.fiber.dispose()
  })
  it('trigger word-boundary: "cat" không khớp "concatenate"; khớp "cat!"', async () => {
    const r = await boot()
    r.skills.register({ name: 'c', description: 'd', instructions: 'i', triggers: ['cat'], userInvocable: true })
    expect(resolveActiveSkills(r.skills, 'please concatenate files', undefined)).toHaveLength(0)
    expect(resolveActiveSkills(r.skills, 'my cat!', undefined)).toHaveLength(1)
    await r.fiber.dispose()
  })
  it('trigger case-insensitive + NFKC + trim', async () => {
    const r = await boot()
    r.skills.register({ name: 'k', description: 'd', instructions: 'i', triggers: ['  Khiếu Nại  '], userInvocable: true })
    expect(resolveActiveSkills(r.skills, 'tôi muốn KHIẾU nại mạng', undefined)).toHaveLength(1)
    await r.fiber.dispose()
  })
  it('trigger regex-escape: "c++", "a.b", "(x)" khớp literal', async () => {
    const r = await boot()
    r.skills.register({ name: 'cpp', description: 'd', instructions: 'i', triggers: ['c++'], userInvocable: true })
    expect(resolveActiveSkills(r.skills, 'học c++ cơ bản', undefined)).toHaveLength(1)
    expect(resolveActiveSkills(r.skills, 'học cxx cơ bản', undefined)).toHaveLength(0)
    await r.fiber.dispose()
  })
  it('trigger rỗng/whitespace-only không bao giờ match', async () => {
    const r = await boot()
    r.skills.register({ name: 'e', description: 'd', instructions: 'i', triggers: ['', '   '], userInvocable: true })
    expect(resolveActiveSkills(r.skills, 'bất kỳ câu nào', undefined)).toHaveLength(0)
    await r.fiber.dispose()
  })
  it('nhiều trigger/match cùng lúc -> trả tất cả', async () => {
    const r = await boot()
    r.skills.register({ name: 's1', description: 'd', instructions: 'i', triggers: ['mạng'], userInvocable: true })
    r.skills.register({ name: 's2', description: 'd', instructions: 'i', triggers: ['cước'], userInvocable: true })
    expect(resolveActiveSkills(r.skills, 'sự cố mạng và cước phí', undefined)).toHaveLength(2)
    await r.fiber.dispose()
  })
  it('visibleTo lọc skill riêng user khác; explicit get sai owner -> throw', async () => {
    const r = await boot()
    r.skills.upsert({ name: 'priv', description: 'd', instructions: 'i', triggers: ['kw'], userInvocable: true, ownerId: 'u-other' })
    expect(resolveActiveSkills(r.skills, 'kw', undefined, 'u-me')).toHaveLength(0)
    expect(() => resolveActiveSkills(r.skills, 'x', 'priv', 'u-me')).toThrow(/not user-invocable/)
    await r.fiber.dispose()
  })
  it('trùng tên global + user: get ưu tiên bản user; list dedupe 1 bản', async () => {
    const r = await boot()
    r.skills.register({ name: 'dup', description: 'global', instructions: 'g', triggers: [], userInvocable: true })
    r.skills.upsert({ name: 'dup', description: 'mine', instructions: 'm', triggers: [], userInvocable: true, ownerId: 'u1' })
    expect(r.skills.get('dup', 'u1')!.description).toBe('mine')
    expect(r.skills.list({ visibleTo: 'u1' }).filter((s) => s.name === 'dup')).toHaveLength(1)
    await r.fiber.dispose()
  })
  it('register trùng tên global -> throw; upsert ghi đè êm', async () => {
    const r = await boot()
    r.skills.register({ name: 'dup2', description: 'd', instructions: 'i', triggers: [], userInvocable: true })
    expect(() => r.skills.register({ name: 'dup2', description: 'd', instructions: 'i', triggers: [], userInvocable: true })).toThrow(/already registered/)
    expect(() => r.skills.upsert({ name: 'dup2', description: 'd2', instructions: 'i', triggers: [], userInvocable: true })).not.toThrow()
    await r.fiber.dispose()
  })
  it('readResource: skill không tồn tại / resource sai / không reader -> throw rõ', async () => {
    const r = await boot()
    r.skills.register({ name: 'nr', description: 'd', instructions: 'i', triggers: [], userInvocable: true })
    await expect(r.skills.readResource('ghost', 'a.md')).rejects.toThrow(/not found/)
    await expect(r.skills.readResource('nr', 'missing.md')).rejects.toThrow(/not found/)
    await expect(r.skills.readResource('nr', 'missing.md')).rejects.toThrow()
    await r.fiber.dispose()
  })
  it('message unicode dài 100k + trigger ở cuối vẫn match', async () => {
    const r = await boot()
    r.skills.register({ name: 'tail', description: 'd', instructions: 'i', triggers: ['chốt'], userInvocable: true })
    expect(resolveActiveSkills(r.skills, 'n'.repeat(100_000) + ' chốt', undefined)).toHaveLength(1)
    await r.fiber.dispose()
  })
})

describe('S2b buildSkillRouterQuery (router thấy context, không seam mới)', () => {
  it('không context (turn đầu) -> trả nguyên message', () => {
    expect(buildSkillRouterQuery('làm gì đó')).toBe('làm gì đó')
    expect(buildSkillRouterQuery('x', {})).toBe('x')
    expect(buildSkillRouterQuery('x', { history: [], summary: '  ' })).toBe('x')
  })
  it('có history -> nhãn Recent + Current, message hiện tại cuối cùng', () => {
    const q = buildSkillRouterQuery('làm tiếp như trên', {
      history: [
        { role: 'user', content: 'phân tích cohort retention' },
        { role: 'assistant', content: 'đây là ma trận retention...' },
      ],
    })
    expect(q).toContain('[Recent conversation]')
    expect(q).toContain('User: phân tích cohort retention')
    expect(q).toContain('Assistant: đây là ma trận retention...')
    expect(q).toContain('[Current request]\nlàm tiếp như trên')
    expect(q.indexOf('[Current request]')).toBeGreaterThan(q.indexOf('[Recent conversation]'))
  })
  it('có summary -> khối Session summary đứng trước conversation', () => {
    const q = buildSkillRouterQuery('tiếp', { summary: 'đang làm cohort', history: [{ role: 'user', content: 'hi' }] })
    expect(q).toContain('[Session summary]\nđang làm cohort')
    expect(q.indexOf('[Session summary]')).toBeLessThan(q.indexOf('[Recent conversation]'))
  })
  it('lọc role lạ/system/rỗng; chỉ giữ tối đa 6 message gần nhất', () => {
    const history = [
      { role: 'system', content: 'sys' },
      { role: 'tool', content: 'tool-out' },
      { role: 'user', content: '   ' },
      ...Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `m${i}` })),
    ]
    const q = buildSkillRouterQuery('now', { history })
    expect(q).not.toContain('sys')
    expect(q).not.toContain('tool-out')
    expect(q).toContain('User: m9')
    expect(q).not.toContain('User: m0') // chỉ 6 message cuối (m4..m9)
    expect(q).toContain('User: m4')
  })
  it('message dài 5k + summary dài 5k -> clip có marker, query gọn', () => {
    const q = buildSkillRouterQuery('q', {
      summary: 's'.repeat(5000),
      history: [{ role: 'user', content: 'u'.repeat(5000) }],
    })
    expect(q.length).toBeLessThan(3000)
    expect(q).toContain('[truncated]')
  })
  it('message rỗng + có history -> vẫn có nhãn Current (router không mù)', () => {
    const q = buildSkillRouterQuery('', { history: [{ role: 'user', content: 'abc' }] })
    expect(q).toContain('[Current request]\n')
  })
})

describe('S3 skillCatalogGuidance exhaustive', () => {
  it('description undefined/rỗng/dài -> vẫn render JSON, không throw', () => {
    for (const d of [undefined, '', 'x'.repeat(20_000)]) {
      expect(() => skillCatalogGuidance([{ name: 'a', description: d } as any], undefined, true)).not.toThrow()
    }
  })
  it('nhiều skill (200) -> 1 string, chứa skill_catalog + guardrail cuối', () => {
    const skills = Array.from({ length: 200 }, (_, i) => ({ name: `s${i}`, description: `d${i}` }) as any)
    const out = skillCatalogGuidance(skills, undefined, true)
    expect(out).toContain('<skill_catalog>'); expect(out).toContain('never overrides')
  })
  it('tên skill unicode/đặc biệt giữ nguyên trong JSON', () => {
    const out = skillCatalogGuidance([{ name: 'kỹ-năng_1', description: 'mô tả 😀' } as any], undefined, true)
    expect(out).toContain('kỹ-năng_1')
  })
})

describe('S4 prompt-registry exhaustive', () => {
  async function boot() { const r = new Context(); r.plugin(promptReg); await settle(); return r }
  it('chưa có section -> render throw rendered empty', async () => {
    const r = await boot()
    expect(() => r.prompts.render({ driver: 'default' })).toThrow()
    await r.fiber.dispose()
  })
  it('section text rỗng/whitespace bị lọc ở assemble', async () => {
    const r = await boot()
    r.prompts.section({ name: 'empty', order: 1, text: '   ' })
    r.prompts.section({ name: 'ok', order: 2, text: 'hello' })
    expect(r.prompts.render({}).content).toBe('hello')
    await r.fiber.dispose()
  })
  it('sắp xếp theo order tăng dần, drivers filter đúng', async () => {
    const r = await boot()
    r.prompts.section({ name: 'b', order: 20, text: 'B' })
    r.prompts.section({ name: 'a', order: 10, text: 'A' })
    r.prompts.section({ name: 'rlm-only', order: 15, text: 'R', drivers: ['rlm'] })
    expect(r.prompts.render({ driver: 'default' }).content).toBe('A\n\nB')
    expect(r.prompts.render({ driver: 'rlm' }).content).toBe('A\n\nR\n\nB')
    await r.fiber.dispose()
  })
  it('text function throw -> lan ra ngoài (không swallow)', async () => {
    const r = await boot()
    r.prompts.section({ name: 'bad', order: 1, text: () => { throw new Error('boom-fn') } })
    expect(() => r.prompts.render({})).toThrow(/boom-fn/)
    await r.fiber.dispose()
  })
  it.each([
    [{ name: '', order: 1, text: 'x' }],
    [{ name: 'n', order: NaN, text: 'x' }],
    [{ name: 'd', order: 1, text: 'x', drivers: [''] }],
  ])('section malformed %j -> throw', async (sec) => {
    const r = await boot()
    expect(() => r.prompts.section(sec as any)).toThrow()
    await r.fiber.dispose()
  })
  it('trùng tên section -> throw already registered', async () => {
    const r = await boot()
    r.prompts.section({ name: 'dup', order: 1, text: 'x' })
    expect(() => r.prompts.section({ name: 'dup', order: 2, text: 'y' })).toThrow(/already registered/)
    await r.fiber.dispose()
  })
  it('version là hash 12 hex của content (render 2 lần giống nhau)', async () => {
    const r = await boot()
    r.prompts.section({ name: 's', order: 1, text: 'abc' })
    const v1 = r.prompts.render({}); const v2 = r.prompts.render({})
    expect(v1.version).toBe(v2.version); expect(v1.version).toMatch(/^[a-f0-9]{12}$/)
    await r.fiber.dispose()
  })
})

describe('S5 environment-note exhaustive', () => {
  it('Invalid Date -> fallback về giờ hiện tại, không throw (self-improve)', () => {
    let note = ''
    expect(() => { note = environmentNote(new Date('invalid')) }).not.toThrow()
    expect(note).toContain(`current year is ${new Date().getUTCFullYear()}`)
  })
  it('input không phải Date (string/number cast) -> fallback, không throw', () => {
    expect(() => environmentNote('2026-01-01' as any)).not.toThrow()
    expect(() => environmentNote(12345 as any)).not.toThrow()
  })
  it('năm nhuận/năm biên 1999/2100 render đúng', () => {
    expect(environmentNote(new Date('2000-02-29T00:00:00Z'))).toContain('current year is 2000')
    expect(environmentNote(new Date('2100-01-01T00:00:00Z'))).toContain('last year is 2099')
  })
  it('inject position lạ (cast any) -> rơi về nhánh end', () => {
    const out = injectEnvironmentNote({ content: 'base', version: 'v' }, 'nope' as any)
    expect(out.content.startsWith('base')).toBe(true)
  })
  it('rendered.content đã chứa ## Environment -> vẫn append (duplicate có chủ ý)', () => {
    const out = injectEnvironmentNote({ content: 'x\n## Environment\nold', version: 'v' }, 'end')
    expect(out.content.match(/## Environment/g)!.length).toBe(2)
  })
  it('identity với nhiều \\n\\n -> chèn sau đoạn đầu tiên', () => {
    const out = injectEnvironmentNote({ content: 'A\n\nB\n\nC', version: 'v' }, 'identity')
    expect(out.content.indexOf('## Environment')).toBeLessThan(out.content.indexOf('B'))
  })
  it('version luôn = sha256(content)[:12] kể cả content lớn', () => {
    const big = 'z'.repeat(100_000)
    const out = injectEnvironmentNote({ content: big, version: 'stale' }, 'end')
    expect(out.version).not.toBe('stale'); expect(out.version).toMatch(/^[a-f0-9]{12}$/)
  })
  it('promptDefaultAgent render + inject end giữ câu định danh default', async () => {
    const r = new Context(); r.plugin(promptReg); r.plugin(promptRegistry); await settle()
    const rendered = r.prompts.render({ driver: 'default' })
    const out = injectEnvironmentNote(rendered, 'end')
    expect(out.content).toContain('default conversational agent in agent-core')
    expect(out.content).toContain('## Environment')
    await r.fiber.dispose()
  })
})
