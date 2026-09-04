// line_reader.py là lớp chống treo phía Python: gộp mọi lần đọc stdin về một
// đường duy nhất có timeout, thay cho `sys.stdin.readline()` chặn vô hạn ở cầu
// nối host. Logic nằm bên Python nên chấm bằng self-test Python, chạy qua đây
// để nó không mục — cùng cách tests/sandbox-cancellation.test.ts spawn python3.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const script = path.resolve('bundles/loop-drivers/loop-rlm/python/test_line_reader.py')

describe('python line_reader — một đường đọc stdin duy nhất, có timeout', () => {
  it('self-test Python pass toàn bộ (đọc xen kẽ, timeout đúng lúc, không mất dòng tới muộn)', async () => {
    const { stdout } = await run(process.env.RLM_PYTHON_BIN ?? 'python3', [script], { timeout: 60_000 })
    expect(stdout).toContain('TẤT CẢ PASS')
    expect(stdout).not.toContain('FAIL')
  }, 70_000)
})
