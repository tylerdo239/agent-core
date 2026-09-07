// Con số phiên bản phải đến từ ĐÚNG MỘT nguồn cho cả hai phía. Web nướng
// hằng số vào bundle lúc build, backend trả số của chính nó qua /health —
// lệch nhau là dấu hiệu một bên chưa được cập nhật (xem src/version.ts).
// Test này chốt: chỉ có một hằng số, và /health thật sự trả nó ra.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../src/version.ts'

describe('APP_VERSION — một nguồn duy nhất cho cả web lẫn backend', () => {
  it('là số nguyên dương, để so "cái nào mới hơn" ngay lập tức', () => {
    expect(Number.isInteger(APP_VERSION)).toBe(true)
    expect(APP_VERSION).toBeGreaterThan(0)
  })

  it('src/version.ts KHÔNG import gì — nếu không, frontend kéo cả code backend vào bundle', () => {
    const source = readFileSync(path.resolve('src/version.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\brequire\(/)
  })

  it('web import THẲNG hằng số này, không hỏi backend — bundle cũ phải mang số cũ', () => {
    const app = readFileSync(path.resolve('apps/web/src/App.tsx'), 'utf8')
    expect(app).toMatch(/import \{ APP_VERSION \} from '\.\.\/\.\.\/\.\.\/src\/version\.ts'/)
    expect(app).toMatch(/uiVersion=\{APP_VERSION\}/)
  })

  it('không có bản sao thứ hai của con số ở phía web', () => {
    const app = readFileSync(path.resolve('apps/web/src/App.tsx'), 'utf8')
    expect(app).not.toMatch(/const\s+APP_VERSION\s*=/)
  })
})
