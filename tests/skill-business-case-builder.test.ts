// tests/skill-business-case-builder.test.ts — xác nhận skill mới
// bundles/skills/business-case-builder được skill-filesystem THẬT SỰ phát
// hiện khi quét bundles/skills/ (không cần sửa src/serve.ts — xem
// docs/agent-core-skill-business-case-builder-plan.md mục 0), đủ 5
// reference + 1 template + 1 checklist, và user-invocable (không set
// `user-invocable: false` trong frontmatter -> mặc định true, hiện trong
// dropdown "Chọn skill", đúng nhóm với data-scientist/analyze).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as skillFilesystem from '../bundles/providers/skill-filesystem/index.ts'

const agentCoreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillsRoot = path.join(agentCoreRoot, 'bundles', 'skills')

async function settle() {
  await new Promise((r) => setTimeout(r, 20))
}

describe('skill business-case-builder — discover thật qua skill-filesystem', () => {
  it('quét bundles/skills/ thật -> đăng ký đúng skill, user-invocable, đủ resource', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    root.plugin(skillFilesystem, { root: skillsRoot })
    await settle()

    const skill = root.skills.get('business-case-builder')
    expect(skill).toBeDefined()
    expect(skill!.userInvocable).toBe(true)
    expect(skill!.instructions).toContain('Nguyên tắc bắt buộc')

    const resourcePaths = (skill!.resources ?? []).map((r) => r.path)
    for (const expected of [
      'references/kpi-framework.md',
      'references/business-analysis-guide.md',
      'references/scientific-analysis-guide.md',
      'references/internal-analysis-guide.md',
      'references/web-research-guide.md',
      'templates/business-scenario-report.md',
      'checklists/completeness-checklist.md',
      'scripts/kpi_calculator.py',
    ]) {
      expect(resourcePaths).toContain(expected)
    }
  })

  it('hiện trong danh sách userInvocableOnly (dropdown "Chọn skill")', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    root.plugin(skillFilesystem, { root: skillsRoot })
    await settle()

    const names = root.skills.list({ userInvocableOnly: true }).map((s) => s.name)
    expect(names).toContain('business-case-builder')
  })

  it('readResource() đọc đúng nội dung kpi-framework.md (công thức LTV thật, không phải placeholder)', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    root.plugin(skillFilesystem, { root: skillsRoot })
    await settle()

    const content = await root.skills.readResource('business-case-builder', 'references/kpi-framework.md')
    expect(content.content).toContain('ARPU × gross margin % ÷ churn rate')
  })

  // Follow-up: user báo lại đúng — skill lúc đầu chỉ dùng được qua dropdown
  // "Chọn skill" (RLM-only ở UI), không tách khỏi RLM như yêu cầu ban đầu.
  // loop-default TỰ gọi `runCtx.skills.match(userMessage)` (xem
  // bundles/loop-drivers/loop-default/index.ts) — không có gì RLM-riêng ở
  // tầng seam/backend, chỉ thiếu `triggers` để tự kích hoạt qua chat thường.
  it('match() tự kích hoạt qua từ khoá — dùng được ở chat thường (driver default), KHÔNG cần chọn dropdown/RLM', async () => {
    const root = new Context()
    root.plugin(skillRegistry)
    root.plugin(skillFilesystem, { root: skillsRoot })
    await settle()

    const matched = root.skills.match('Giúp tôi xây kịch bản kinh doanh cho 1 quán cà phê')
    expect(matched.map((s) => s.name)).toContain('business-case-builder')

    const notMatched = root.skills.match('Hôm nay thời tiết thế nào?')
    expect(notMatched.map((s) => s.name)).not.toContain('business-case-builder')
  })
})
