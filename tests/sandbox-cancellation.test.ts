import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as sandboxIpython from '../bundles/providers/sandbox-ipython/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import { LlmService } from '../seams/llm.ts'

class UnusedLlm extends LlmService { async complete() { return { content: '' } } }

describe('sandbox cancellation', () => {
  it('terminates a synchronous Python worker and allows a clean worker next turn', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-core-cancel-'))
    const worker = path.join(directory, 'worker.py')
    writeFileSync(worker, [
      'import json, sys, time',
      'print(json.dumps({"type":"__ready__"}), flush=True)',
      'for line in sys.stdin:',
      '    time.sleep(30)',
    ].join('\n'))
    const root = new Context()
    root.plugin(sessionRegistry); root.plugin(skillRegistry); root.plugin(toolRegistry); root.plugin(UnusedLlm)
    root.plugin(sandboxIpython, { workerPath: worker, runtimeRoot: directory })
    await new Promise((resolve) => setTimeout(resolve, 20))
    try {
      await root.sandbox.openSession('s', { cwd: directory })
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 30)
      const started = Date.now()
      const consume = async () => { for await (const _event of root.sandbox.request('s', 'slow', {}, { signal: controller.signal })) { /* noop */ } }
      await expect(consume()).rejects.toMatchObject({ name: 'AbortError' })
      expect(Date.now() - started).toBeLessThan(2_000)
      await root.sandbox.openSession('s', { cwd: directory })
    } finally {
      await root.sandbox.closeSession('s')
      await root.fiber.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 10_000)
})
