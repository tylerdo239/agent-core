// Bug user mô phỏng phát hiện: upload "ảnh.png"/"báo cáo.pdf" bị xén thành
// "_nh.png"/"b_o_c_o.pdf" (whitelist ASCII trong safeRelativePath).
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as workspaceLocal from '../bundles/providers/workspace-local/index.ts'

const dirs: string[] = []
async function boot() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ws-unicode-'))
  dirs.push(base)
  const root = new Context()
  root.plugin(workspaceLocal, { basePath: base })
  await new Promise((r) => setTimeout(r, 20))
  return root
}
afterEach(async () => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('workspace-local unicode filenames', () => {
  it('giữ nguyên chữ Việt/CJK, space -> _ (đúng ca user gặp)', async () => {
    const root = await boot()
    const cases: Array<[string, string]> = [
      ['ảnh.png', 'ảnh.png'],
      ['báo cáo.pdf', 'báo_cáo.pdf'],
      ['dữ liệu quý 1.csv', 'dữ_liệu_quý_1.csv'],
      ['中文文件名.txt', '中文文件名.txt'],
      ['file (1).txt', 'file_1_.txt'],
    ]
    for (const [input, expected] of cases) {
      const r = await root.workspace.writeFile('s1', input, Buffer.from('x'))
      expect(r.path).toBe(expected)
      expect((await root.workspace.readFile('s1', expected)).toString()).toBe('x')
    }
    expect((await root.workspace.listFiles('s1')).map((f) => f.path).sort())
      .toEqual(cases.map(([, e]) => e).sort())
    await root.fiber.dispose()
  })
  it('NFD (macOS, dấu tổ hợp rời) -> NFC, không xén oan', async () => {
    const root = await boot()
    const nfd = 'a\u0309nh.png' // 'ả' dạng decomposed
    const r = await root.workspace.writeFile('s1', nfd, Buffer.from('x'))
    expect(r.path).toBe('ảnh.png')
    await root.fiber.dispose()
  })
  it('traversal vẫn bị chặn (.., NUL, rỗng); absolute-path rút về relative an toàn', async () => {
    const root = await boot()
    for (const bad of ['../evil.txt', '..', 'a\0b.txt', '', 'a/../../b.txt']) {
      await expect(root.workspace.writeFile('s1', bad, Buffer.from('x'))).rejects.toThrow(/escapes/)
    }
    // '/abs.txt' -> filter bỏ segment rỗng -> 'abs.txt' nằm gọn trong workspace
    const abs = await root.workspace.writeFile('s1', '/abs.txt', Buffer.from('x'))
    expect(abs.path).toBe('abs.txt')
    // subdir hợp lệ vẫn cho
    const r = await root.workspace.writeFile('s1', 'data/báo cáo.csv', Buffer.from('a,b\n1,2'))
    expect(r.path).toBe('data/báo_cáo.csv')
    await root.fiber.dispose()
  })
  it('dataset tiếng Việt vào index.json đọc lại được', async () => {
    const root = await boot()
    await root.workspace.writeFile('s1', 'doanh thu.csv', Buffer.from('t,x\n1,2'))
    const snap = await root.workspace.inspect('s1')
    expect(JSON.stringify(snap.resources.datasets)).toContain('doanh_thu')
    await root.fiber.dispose()
  })
})
