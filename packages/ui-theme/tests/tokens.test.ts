// Phase 10.1 deliverable: verify cấu trúc token 3 tầng thật (không chỉ tin
// file CSS viết đúng bằng mắt) — parse trực tiếp tokens.css, xác nhận:
// (1) không còn dấu vết namespace `--dsw-*` của dsh gốc; (2) mọi biến
// alias/specific tham chiếu `var(--...)` trỏ tới 1 biến CÓ THẬT trong file
// (không dangling reference); (3) alias/specific KHÔNG hardcode màu thô —
// luôn đi qua var() (đúng nguyên tắc 3 tầng: component chỉ chạm alias/
// specific, alias/specific chỉ chạm static, không ai "nhảy tầng"); (4) giá
// trị cụ thể bảng màu mới (cam #F26F21/trắng/đen) đúng như user yêu cầu,
// không lẫn màu xanh gốc của dsh.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(__dirname, '../src/tokens.css'), 'utf-8')

interface Declaration {
  name: string
  value: string
}

function parseDeclarations(source: string): Declaration[] {
  const decls: Declaration[] = []
  const re = /--([a-zA-Z0-9-]+):\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    decls.push({ name: match[1], value: match[2].trim() })
  }
  return decls
}

const decls = parseDeclarations(css)
const byName = new Map(decls.map((d) => [d.name, d.value]))

describe('Phase 10.1 — packages/ui-theme token 3 tầng', () => {
  it('parse được ít nhất 1 token mỗi tầng (static/alias/specific) — file không rỗng/sai cấu trúc', () => {
    const names = decls.map((d) => d.name)
    expect(names.some((n) => n.startsWith('static-'))).toBe(true)
    expect(names.some((n) => n.startsWith('alias-'))).toBe(true)
    expect(names.some((n) => n.startsWith('specific-'))).toBe(true)
  })

  it('KHÔNG còn dấu vết namespace --dsw-* của dsh gốc (đây là bảng màu MỚI, không phải copy nguyên giá trị)', () => {
    expect(css).not.toContain('dsw')
  })

  it('mọi token alias/specific tham chiếu var(--...) trỏ tới 1 token CÓ THẬT trong file (không dangling reference)', () => {
    for (const d of decls) {
      if (!d.name.startsWith('alias-') && !d.name.startsWith('specific-')) continue
      const refs = [...d.value.matchAll(/var\(--([a-zA-Z0-9-]+)\)/g)].map((m) => m[1])
      expect(refs.length, `token --${d.name} phải tham chiếu qua var(), không hardcode: "${d.value}"`).toBeGreaterThan(0)
      for (const ref of refs) {
        expect(byName.has(ref), `--${d.name} tham chiếu --${ref} nhưng --${ref} không tồn tại trong file`).toBe(true)
      }
    }
  })

  it('alias/specific KHÔNG hardcode màu thô (hex/rgb) — luôn qua var(), đúng nguyên tắc 3 tầng không nhảy tầng', () => {
    const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\(/
    for (const d of decls) {
      if (!d.name.startsWith('alias-') && !d.name.startsWith('specific-')) continue
      expect(rawColorPattern.test(d.value), `--${d.name} hardcode màu thô thay vì tham chiếu static: "${d.value}"`).toBe(false)
    }
  })

  it('bảng màu MỚI đúng giá trị user yêu cầu: cam #F26F21 chủ đạo, nền trắng, chữ đen #222222', () => {
    expect(byName.get('static-brand-500')?.toLowerCase()).toBe('#f26f21')
    expect(byName.get('static-neutral-0')?.toLowerCase()).toBe('#ffffff')
    expect(byName.get('static-neutral-900')?.toLowerCase()).toBe('#222222')
  })

  it('token ngữ nghĩa cấp cao nhất (bg-base/label-primary/accent) trỏ đúng về đúng static tương ứng', () => {
    expect(byName.get('alias-bg-base')).toBe('var(--static-neutral-0)')
    expect(byName.get('alias-label-primary')).toBe('var(--static-neutral-900)')
    expect(byName.get('alias-accent')).toBe('var(--static-brand-500)')
  })

  it('bubble user dùng tint nhạt (accent-subtle-bg), KHÔNG dùng cam đặc (accent) làm nền -- quyết định thiết kế đã ghi rõ trong file', () => {
    expect(byName.get('specific-bubble-user-bg')).toBe('var(--alias-accent-subtle-bg)')
    expect(byName.get('specific-bubble-user-bg')).not.toBe('var(--alias-accent)')
  })
})
