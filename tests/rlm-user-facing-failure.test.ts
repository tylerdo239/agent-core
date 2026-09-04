// Bug thật user báo (R7, chia cho 0 ba lần): turn RLM fail, user Việt nhận
// nguyên chuỗi "Error threshold exceeded: 3 consecutive errors (limit: 3)" —
// jargon nội bộ của thư viện, không một chữ giải thích. Và đúng lúc đó RLM đã
// có sẵn `partial_answer` đính trên chính exception mà harness vứt đi.
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
import { turnFailureText } from '../src/user-facing-error.ts'

const RAW = 'Error threshold exceeded: 3 consecutive errors (limit: 3)'
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

function stack(events: SandboxEvent[]) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'rlm-fail-')); dirs.push(base)
  class Sb extends SandboxService {
    async run(): Promise<SandboxRunResult> { return { stdout: '', stderr: '', exitCode: 0 } }
    async openSession() {}
    async closeSession() {}
    async *request() { for (const e of events) yield e }
  }
  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry)
  root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
  root.plugin(stateSqlite, { path: ':memory:' })
  class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'host' } } }
  root.plugin(L); root.plugin(contextCompactorLlm)
  root.plugin(memoryRolling, { basePath: path.join(base, 'mem') })
  root.plugin(StubWorkspace as any, base)
  root.plugin((ctx: Context) => { ctx.plugin(Sb as any) })
  root.plugin(loopRegistry); root.plugin(loopRlm); root.plugin(agentRunner)
  return root
}

describe('turn RLM thất bại — user đọc được, không phải jargon tiếng Anh', () => {
  it('cạn error budget -> user nhận câu tiếng Việt, KHÔNG nhận chuỗi nội bộ', async () => {
    const root = stack([{
      type: '__result__', status: 'failed', answer: RAW,
      turn_issue: { code: 'NO_PROGRESS', message: RAW },
    } as SandboxEvent])
    await settle()
    const session = new Session('fail-jargon', 8, undefined, 'rlm')
    const result = await root.agent.runTurn('rlm', session, { message: 'chia cho 0 giúp tôi' })

    expect(result.content).not.toContain('Error threshold exceeded')
    expect(result.content).not.toContain('consecutive errors')
    expect(result.content).toContain('Lượt này chưa hoàn tất')
    expect(result.content).toMatch(/lỗi liên tiếp/)
    await root.fiber.dispose()
  })

  it('chuỗi gốc KHÔNG mất — vẫn nằm trong session state để debug/turn kế tiếp', async () => {
    const root = stack([{
      type: '__result__', status: 'failed', answer: RAW,
      turn_issue: { code: 'NO_PROGRESS', message: RAW },
    } as SandboxEvent])
    await settle()
    const session = new Session('fail-keeps-raw', 8, undefined, 'rlm')
    await root.agent.runTurn('rlm', session, { message: 'x' })
    const state = session.extension<any>('loop:rlm', () => ({}))
    expect(state.lastError.message).toBe(RAW)
    expect(state.lastError.code).toBe('NO_PROGRESS')
    await root.fiber.dispose()
  })

  it('có partial_answer -> phần đã làm được đứng TRƯỚC, ghi chú đứng sau (không vứt đi)', async () => {
    const root = stack([{
      type: '__result__', status: 'failed', answer: RAW,
      turn_issue: { code: 'NO_PROGRESS', message: RAW, partial_answer: 'Đã đọc xong dataset: 1200 dòng, 8 cột.' },
    } as SandboxEvent])
    await settle()
    const session = new Session('fail-partial', 8, undefined, 'rlm')
    const result = await root.agent.runTurn('rlm', session, { message: 'x' })

    expect(result.content).toContain('Đã đọc xong dataset: 1200 dòng, 8 cột.')
    expect(result.content.indexOf('Đã đọc xong')).toBeLessThan(result.content.indexOf('Lượt này chưa hoàn tất'))
    await root.fiber.dispose()
  })

  it('turn thành công KHÔNG bị đụng vào', async () => {
    const root = stack([
      { type: 'final_answer', content: 'Kết quả: 42' } as SandboxEvent,
      { type: '__result__', status: 'completed', answer: 'Kết quả: 42', memory: { state: 'completed', request: 'q', outcome: 'o', trajectory: {}, context_index: 0, history_index: 0, next_context_index: 1, next_history_index: 1 } } as SandboxEvent,
    ])
    await settle()
    const session = new Session('fail-none', 8, undefined, 'rlm')
    expect((await root.agent.runTurn('rlm', session, { message: 'x' })).content).toBe('Kết quả: 42')
    await root.fiber.dispose()
  })

  it('mã lỗi lạ/không rõ -> vẫn ra câu tiếng Việt chung, không rơi về chuỗi rỗng', () => {
    expect(turnFailureText(undefined).content).toContain('Lượt này chưa hoàn tất')
    expect(turnFailureText('TIMEOUT').content).toMatch(/quá lâu/)
  })
})
