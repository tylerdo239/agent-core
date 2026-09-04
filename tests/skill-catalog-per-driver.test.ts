// Catalog THẬT (bundles/skills) nhìn từ mỗi loop. Chốt bằng invariant chứ
// không liệt kê cứng toàn bộ tên: thêm skill mới không làm đỏ test, nhưng
// khai sai `drivers` thì đỏ ngay.
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as skillFilesystem from '../bundles/providers/skill-filesystem/index.ts'
import * as skillSupportTone from '../bundles/skills/skill-support-tone/index.ts'

let root: Context
const names = (driver?: string) => root.skills.list({ driver }).map((s) => s.name).sort()

beforeAll(async () => {
  root = new Context()
  root.plugin(skillRegistry)
  root.plugin(skillFilesystem, { root: path.resolve('bundles/skills') })
  root.plugin(skillSupportTone)
  await new Promise((resolve) => setTimeout(resolve, 300))
})
afterAll(async () => { await root.fiber.dispose() })

describe('catalog skill theo từng loop driver', () => {
  it('catalog của mỗi driver là tập con của toàn bộ, và mọi skill đều thuộc ít nhất 1 driver', () => {
    const all = names()
    for (const driver of ['default', 'rlm']) {
      expect(all).toEqual(expect.arrayContaining(names(driver)))
    }
    const union = new Set([...names('default'), ...names('rlm')])
    expect([...union].sort()).toEqual(all)
  })

  it('default-loop KHÔNG được thấy skill cần sandbox Python/workspace', () => {
    // Những skill này bảo model đọc dataset và chạy pandas/sklearn/matplotlib —
    // default-loop không có tool nào làm được, nạp vào là hứa suông.
    const needSandbox = ['data-profiling', 'data-scientist', 'data-visualization', 'ml-modeling',
      'pandas-expert', 'product-analytics', 'statistical-analysis', 'time-series-analysis',
      'deliverable-export']
    for (const name of needSandbox) {
      expect(names('rlm')).toContain(name)
      expect(names('default')).not.toContain(name)
    }
  })

  it('default-loop thấy đúng những skill chạy được bằng web_search/database_query', () => {
    expect(names('default')).toEqual(expect.arrayContaining([
      'web-research', 'report-writing', 'business-case-builder', 'sql-to-insights',
    ]))
  })

  it('catalog default-loop đủ nhỏ để router phân biệt được (gộp 18 -> còn ít)', () => {
    expect(names('default').length).toBeLessThanOrEqual(8)
  })

  it('mọi skill đều có description nói được "khi nào dùng", không rỗng', () => {
    for (const skill of root.skills.list()) {
      expect(skill.description.length, `${skill.name} thiếu description`).toBeGreaterThan(40)
    }
  })

  it('skill đã gộp không còn tồn tại như skill riêng (tránh trùng lặp làm router chọn nhầm)', () => {
    const merged = ['explore-data', 'validate-data', 'data-quality-audit', 'analyze',
      'scikit-learn-machine-learning', 'ml-feature-engineering', 'model-evaluation-report',
      'cohort-analysis', 'funnel-analysis', 'segmentation-analysis']
    for (const name of merged) expect(names()).not.toContain(name)
  })
})
