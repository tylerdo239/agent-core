// Bug thật user báo: turn RLM chạy 25+ phút, KHÔNG throw, KHÔNG event mới,
// worker Python utime=0 (nằm chờ, không spin). Ba lớp timeout tưởng là có đều
// không nằm trên đường bị kẹt:
//   - `max_timeout` chỉ là câu `if` ở ĐẦU mỗi vòng lặp iteration trong
//     vendor/rlm/rlm/core/rlm.py -> kẹt BÊN TRONG một iteration không bao giờ
//     chạm tới nó;
//   - `cell_timeout` chỉ phủ ô REPL;
//   - cầu nối host trong python/worker.py chờ `sys.stdin.readline()` CHẶN VÔ
//     HẠN, không deadline.
// Hệ quả: agent-runner xâu chuỗi turn theo session nên một driver treo làm mọi
// turn sau của session đó kẹt vĩnh viễn. Watchdog phía TS là lớp duy nhất phủ
// được mọi kiểu kẹt vì nó không phụ thuộc worker còn sống.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopRlm from '../bundles/loop-drivers/loop-rlm/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptRlmDataAgent from '../bundles/prompts/prompt-rlm-data-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import * as memoryRolling from '../bundles/providers/memory-rolling/index.ts'
import { LlmCompletion, LlmService } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'
import { SandboxEvent, SandboxRunResult, SandboxService } from '../seams/sandbox.ts'
import { WorkspaceService } from '../seams/workspace.ts'
import type { RlmSessionState } from '../bundles/loop-drivers/loop-rlm/protocol.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

class StubWorkspace extends WorkspaceService {
  constructor(ctx: any, private base: string) { super(ctx) }
  root() { return this.base }
  listDatasets() { return [] }
  listArtifacts() { return [] }
  async inspect() { return { datasets: [], activeDataset: undefined, resources: { datasets: [], artifacts: [] } } }
  async writeFile(_s: string, f: string, c: Buffer) { return { path: f, size: c.length } }
  async readFile() { return Buffer.from('') }
  async deleteFile() { return true }
  async listFiles() { return [] }
  async listSourceFiles() { return [] }
  async listSessionOutputs() { return [] }
  async listProjectOutputs() { return [] }
  async promoteSessionOutput(_w: string, r: string, s: string) { return { path: s, size: 0, mtime: '', sourcePath: s, createdBySession: r } }
}

/** Mô phỏng đúng worker kẹt: không emit event nào, không kết thúc, chỉ nằm chờ. */
class HangingSandbox extends SandboxService {
  aborted = false
  async run(): Promise<SandboxRunResult> { return { stdout: '', stderr: '', exitCode: 0 } }
  async openSession() {}
  async closeSession() {}
  async *request(_s: string, _o: string, _p: Record<string, unknown>, options: { signal?: AbortSignal } = {}) {
    // Y hệt sandbox-ipython thật: abort thì fail queue (và giết worker).
    await new Promise((_resolve, reject) => {
      const abort = () => {
        this.aborted = true
        reject(Object.assign(new Error('sandbox request cancelled'), { name: 'AbortError' }))
      }
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })
    })
    yield {} as SandboxEvent // không bao giờ tới
  }
}

/** Kẹt, nhưng CÓ báo nhịp tim trước khi kẹt — mô phỏng worker đứng chờ model. */
class HeartbeatThenHangSandbox extends SandboxService {
  async run(): Promise<SandboxRunResult> { return { stdout: '', stderr: '', exitCode: 0 } }
  async openSession() {}
  async closeSession() {}
  async *request(_s: string, _o: string, _p: Record<string, unknown>, options: { signal?: AbortSignal } = {}) {
    yield { type: 'heartbeat', phase: 'operation_start', operation: 'prepared_turn' } as SandboxEvent
    yield { type: 'heartbeat', phase: 'bridge_wait', bridge: 'LLM', callId: 'abc123' } as SandboxEvent
    await new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('sandbox request cancelled'), { name: 'AbortError' }))
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })
    })
  }
}

class QuickSandbox extends SandboxService {
  async run(): Promise<SandboxRunResult> { return { stdout: '', stderr: '', exitCode: 0 } }
  async openSession() {}
  async closeSession() {}
  async *request() {
    yield { type: 'final_answer', content: 'xong' } as SandboxEvent
    yield {
      type: '__result__', status: 'completed', answer: 'xong',
      memory: { state: 'completed', request: 'q', outcome: 'xong', trajectory: {}, context_index: 0, history_index: 0, next_context_index: 1, next_history_index: 1 },
    } as SandboxEvent
  }
}

function stack(SandboxImpl: new (...args: any[]) => SandboxService, turnDeadlineMs: number) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'rlm-deadline-'))
  dirs.push(base)
  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry)
  root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
  root.plugin(stateSqlite, { path: ':memory:' })
  class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'host' } } }
  root.plugin(L); root.plugin(contextCompactorLlm)
  root.plugin(memoryRolling, { basePath: path.join(base, 'mem') })
  root.plugin(StubWorkspace as any, base)
  const sandbox = new SandboxImpl(root)
  root.plugin((ctx: Context) => { ctx.plugin(() => sandbox as any) })
  root.plugin(loopRegistry)
  root.plugin(loopRlm, { turnDeadlineMs })
  root.plugin(agentRunner)
  return { root, sandbox: sandbox as any }
}

describe('loop-rlm — hạn chót tuyệt đối cho một turn', () => {
  it('worker kẹt vô hạn -> turn BỊ CẮT trong hạn chót, không treo mãi', async () => {
    const { root, sandbox } = stack(HangingSandbox, 120)
    await settle()
    const session = new Session('deadline-hang', 8, undefined, 'rlm')
    const started = Date.now()
    await expect(root.agent.runTurn('rlm', session, { message: 'câu hỏi treo 🙂' })).rejects.toThrow(/hạn chót/)
    // Không có watchdog thì promise này KHÔNG BAO GIỜ settle.
    expect(Date.now() - started).toBeLessThan(5_000)
    // Signal phải tới được sandbox — đó là thứ giết worker Python thật.
    expect(sandbox.aborted).toBe(true)
    await root.fiber.dispose()
  })

  it('ghi event lỗi mã TIMEOUT + nhớ vào session state cho turn kế tiếp', async () => {
    const { root } = stack(HangingSandbox, 120)
    await settle()
    const session = new Session('deadline-event', 8, undefined, 'rlm')
    await expect(root.agent.runTurn('rlm', session, { message: 'x' })).rejects.toThrow()

    const events = (await root.storage.readEvents(session.id)) as Array<Record<string, unknown>>
    const error = events.find((e) => e.type === 'error')
    expect(error?.error_code).toBe('TIMEOUT')
    expect(String(error?.message)).toMatch(/hạn chót/)
    // Không nuốt thành "sandbox request cancelled" — user tự huỷ là chuyện khác.
    expect(String(error?.message)).not.toMatch(/cancelled/)
    expect(session.extension<RlmSessionState>('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 })).lastError?.code).toBe('TIMEOUT')
    await root.fiber.dispose()
  })

  it('session KHÔNG chết theo: turn sau vẫn chạy được sau khi turn trước bị cắt', async () => {
    const { root } = stack(HangingSandbox, 120)
    await settle()
    const session = new Session('deadline-queue', 8, undefined, 'rlm')
    await expect(root.agent.runTurn('rlm', session, { message: 'kẹt' })).rejects.toThrow()
    // Trước khi có watchdog, turn này xếp hàng sau một promise không bao giờ
    // settle -> kẹt vĩnh viễn, không lỗi, không log.
    await expect(root.agent.runTurn('rlm', session, { message: 'kẹt lần 2' })).rejects.toThrow(/hạn chót/)
    await root.fiber.dispose()
  })

  it('nhịp tim chỉ mặt chỗ kẹt: thông điệp hết hạn nói rõ đang chờ cầu nối LLM', async () => {
    const { root } = stack(HeartbeatThenHangSandbox, 150)
    await settle()
    const session = new Session('deadline-heartbeat', 8, undefined, 'rlm')
    await expect(root.agent.runTurn('rlm', session, { message: 'x' }))
      .rejects.toThrow(/Mốc cuối worker báo: bridge_wait bridge=LLM/)
    await root.fiber.dispose()
  })

  it('nhịp tim KHÔNG bị lưu vào storage (tránh phình event vô ích)', async () => {
    const { root } = stack(HeartbeatThenHangSandbox, 150)
    await settle()
    const session = new Session('deadline-hb-storage', 8, undefined, 'rlm')
    await expect(root.agent.runTurn('rlm', session, { message: 'x' })).rejects.toThrow()
    const events = (await root.storage.readEvents(session.id)) as Array<Record<string, unknown>>
    expect(events.some((e) => e.type === 'heartbeat')).toBe(false)
    // Nhưng thông tin của nó KHÔNG mất — nằm trong thông điệp lỗi.
    expect(String(events.find((e) => e.type === 'error')?.message)).toMatch(/bridge=LLM/)
    await root.fiber.dispose()
  })

  it('worker kẹt trước khi kịp báo mốc nào -> nói thẳng là không có mốc', async () => {
    const { root } = stack(HangingSandbox, 120)
    await settle()
    const session = new Session('deadline-no-hb', 8, undefined, 'rlm')
    await expect(root.agent.runTurn('rlm', session, { message: 'x' }))
      .rejects.toThrow(/không báo mốc nào/)
    await root.fiber.dispose()
  })

  it('turn bình thường KHÔNG bị watchdog đụng vào', async () => {
    const { root } = stack(QuickSandbox, 5_000)
    await settle()
    const session = new Session('deadline-ok', 8, undefined, 'rlm')
    const result = await root.agent.runTurn('rlm', session, { message: 'hỏi nhanh' })
    expect(result.content).toBe('xong')
    await root.fiber.dispose()
  })
})
