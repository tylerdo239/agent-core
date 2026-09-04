// Quan sát thật (lặp lại 3 lần): stack KHÔNG mount tool-web-search, model vẫn
// trả "Tôi sẽ tiến hành tìm kiếm ngay bây giờ..." rồi kết thúc turn với
// steps=0 — user chờ một cái search không bao giờ tới. Nguyên nhân: mệnh lệnh
// "current-state facts always require a web search first" nằm trong
// operating-policy tĩnh, đăng ký VÔ ĐIỀU KIỆN, nên harness ra lệnh cho model
// làm việc nó không có tool để làm. Mệnh lệnh đó nay thuộc về chính
// tool-web-search — prompt tự khớp với bộ tool thực sự có mặt.
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as toolWebSearch from '../bundles/tools/tool-web-search/index.ts'
import { injectEnvironmentNote } from '../src/environment-note.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
const MANDATE = 'require a `web_search` first'

async function renderDefaultPrompt(withWebSearch: boolean) {
  const root = new Context()
  root.plugin(promptRegistry)
  root.plugin(promptDefaultAgent)
  if (withWebSearch) {
    root.plugin(toolRegistry)
    root.plugin(permissionRbac, { rules: { 'web-search': ['search'] } })
    root.plugin(toolWebSearch)
  }
  await settle()
  const content = root.prompts.render({ driver: 'default' }).content
  await root.fiber.dispose()
  return content
}

describe('mệnh lệnh "phải web_search trước" đi theo tool, không nằm trong prompt tĩnh', () => {
  it('KHÔNG mount tool-web-search -> prompt không ra lệnh search (không hứa năng lực không có)', async () => {
    const content = await renderDefaultPrompt(false)
    expect(content).not.toContain(MANDATE)
    expect(content).not.toContain('web search first')
    // Phần còn lại của điều 4 vẫn nguyên vẹn.
    expect(content).toContain('Never claim that a tool or action succeeded before its result confirms it.')
    // Invariant mạnh nhất: stack không có tool tìm kiếm thì prompt KHÔNG được
    // nhắc tới "search" ở bất kỳ đâu — kể cả trong ghi chú môi trường
    // (src/environment-note.ts từng ghi "your search query MUST include
    // <year>", inject vô điều kiện, chính là lời hứa thứ hai bị bỏ sót).
    const withEnvNote = injectEnvironmentNote({ content, version: 'v' }, 'end', new Date('2026-09-04T00:00:00Z')).content
    expect(withEnvNote).not.toMatch(/search/i)
  })

  it('thiếu tool retrieval -> có luật xác định cho tình huống đó (không để model tự chọn bịa hay từ chối)', async () => {
    const content = await renderDefaultPrompt(false)
    expect(content).toContain('no retrieval tool is available this turn')
    expect(content).toContain('Never present specific figures recalled from training data as if they were current.')
  })

  it('CÓ mount tool-web-search -> mệnh lệnh xuất hiện đầy đủ (deploy thật không đổi hành vi)', async () => {
    const content = await renderDefaultPrompt(true)
    expect(content).toContain(MANDATE)
    expect(content).toContain('your training data predates today')
  })
})
