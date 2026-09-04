// Exhaustive loop-rlm: prepareRlmTurn + bridge toStep/workspaceActivities +
// sandbox/turnMemory/workspace failures + control/memory paths + kết nối agent-runner.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
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
import * as workspaceLocal from '../bundles/providers/workspace-local/index.ts'
import { LlmCompletion, LlmService } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'
import { SandboxRunResult, SandboxService } from '../seams/sandbox.ts'
import { TurnMemoryService } from '../seams/turn-memory.ts'
import { WorkspaceService } from '../seams/workspace.ts'
import { SkillSelectionService } from '../seams/skill-selection.ts'
import { prepareRlmTurn, RlmSessionState } from '../bundles/loop-drivers/loop-rlm/protocol.ts'

const settle = () => new Promise((r) => setTimeout(r, 15))
const tmpBase = () => mkdtempSync(path.join(os.tmpdir(), 'rlm-matrix-'))
function fakeMemory(over: any = {}) {
  return {
    snapshot: async () => ({ summary: 'sum', turns: [], currentContext: undefined, resources: { datasets: [], artifacts: [] } }),
    summary: async () => 'sum', sourceContexts: async () => [], recordContext: async () => {},
    recordTurn: async () => ({}),
    completeTurn: async (_s: string, input: any) => ({ update: { summary: 'u', turnSummary: 't' }, turn: { ok: 1 } }),
    clear: async () => {}, ...over,
  } as any
}
function fakePrompts(content = 'RLM base\n\nSecond') { return { render: () => ({ content, version: 'v'.repeat(12) }) } as any }
function fakeWorkspace(over: any = {}) {
  return { datasets: [], activeDataset: undefined, resources: { datasets: [], artifacts: [] }, ...over } as any
}
class ScriptSandbox extends SandboxService {
  constructor(ctx: any, public script: (p: any) => any[]) { super(ctx) }
  async run(): Promise<SandboxRunResult> { return { stdout: '', stderr: '', exitCode: 0 } }
  async openSession() {}
  async *request(_s: string, _o: string, p: Record<string, unknown>) { for (const e of this.script(p)) yield e }
  async closeSession() {}
}
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
function rlmStack(script: (p: any) => any[], opts: { memBase?: string; skillSel?: any } = {}) {
  const base = tmpBase()
  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry); root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
  root.plugin(stateSqlite, { path: ':memory:' })
  class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'host' } } }
  root.plugin(L); root.plugin(contextCompactorLlm)
  root.plugin(memoryRolling, { basePath: path.join(opts.memBase ?? base, 'mem') })
  root.plugin(StubWorkspace as any, base)
  root.plugin((ctx: Context) => { ctx.plugin(ScriptSandbox as any, script) })
  if (opts.skillSel) root.plugin((ctx: Context) => { ctx.plugin(opts.skillSel) })
  root.plugin(loopRegistry); root.plugin(loopRlm); root.plugin(agentRunner)
  return { root, base }
}
const doneResult = (answer = 'ok') => [
  { type: 'final_answer', content: answer },
  { type: '__result__', status: 'completed', answer, memory: { state: 'completed', request: 'q', outcome: answer, trajectory: {}, context_index: 0, history_index: 0, next_context_index: 1, next_history_index: 1 } },
]

describe('R1 prepareRlmTurn exhaustive', () => {
  it('contractVersion=2 + workspaceId/projectId/runId/requestId passthrough + metadata', async () => {
    const s = new Session('r1', 8, undefined, 'rlm', 40, 'u1', 'proj1')
    const p = await prepareRlmTurn({ session: s, input: { message: 'hi', runId: 'run-9', requestId: 'req-9', metadata: { k: 1 } }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })
    expect(p.contractVersion).toBe(2); expect(p.workspaceId).toBe('project:proj1'); expect(p.projectId).toBe('proj1')
    expect(p.runId).toBe('run-9'); expect(p.requestId).toBe('req-9'); expect(p.metadata).toEqual({ k: 1 })
  })
  it('availableTools map đúng name/description/parameters (kể cả thiếu parameters)', async () => {
    const s = new Session('r2', 8, undefined, 'rlm')
    const p = await prepareRlmTurn({ session: s, input: { message: 'hi' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [{ name: 't', description: 'd' } as any, { name: 't2', description: 'd2', parameters: { type: 'object' } } as any], prompts: fakePrompts() })
    expect(p.availableTools).toHaveLength(2); expect(p.availableTools[0].parameters).toBeUndefined()
  })
  it('skill có resources -> selected_skill.resources giữ nguyên; không skill -> không field', async () => {
    const s = new Session('r3', 8, undefined, 'rlm')
    const withSkill = await prepareRlmTurn({ session: s, input: { message: 'hi' }, memory: fakeMemory(), workspace: fakeWorkspace(), skill: { name: 'w', description: 'd', instructions: 'INS', resources: [{ path: 'r.md' }] } as any, tools: [], prompts: fakePrompts() })
    expect((withSkill.context as any).selected_skill.resources).toEqual([{ path: 'r.md' }])
    const s2 = new Session('r3b', 8, undefined, 'rlm')
    expect((await prepareRlmTurn({ session: s2, input: { message: 'hi' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })).context).not.toHaveProperty('selected_skill')
  })
  it('skillCatalog rỗng/undefined -> không có skill_catalog; có -> map name+description (bỏ instructions)', async () => {
    const s = new Session('r4', 8, undefined, 'rlm')
    expect((await prepareRlmTurn({ session: s, input: { message: 'x' }, memory: fakeMemory(), workspace: fakeWorkspace(), skillCatalog: [], tools: [], prompts: fakePrompts() })).context).not.toHaveProperty('skill_catalog')
    const s2 = new Session('r4b', 8, undefined, 'rlm')
    const p = await prepareRlmTurn({ session: s2, input: { message: 'x' }, memory: fakeMemory(), workspace: fakeWorkspace(), skillCatalog: [{ name: 'a', description: 'd', instructions: 'SECRET' } as any], tools: [], prompts: fakePrompts() })
    expect((p.context as any).skill_catalog).toEqual([{ name: 'a', description: 'd' }])
  })
  it('workspace datasets/activeDataset đưa vào context lần đầu; available_tools luôn có', async () => {
    const s = new Session('r5', 8, undefined, 'rlm')
    const p = await prepareRlmTurn({ session: s, input: { message: 'q' }, memory: fakeMemory(), workspace: fakeWorkspace({ datasets: [{ id: 'd1' }], activeDataset: { id: 'd1' } }), tools: [{ name: 't', description: 'd' } as any], prompts: fakePrompts() })
    expect((p.context as any).datasets).toEqual([{ id: 'd1' }])
    expect((p.context as any).available_tools).toHaveLength(1)
  })
  it('turn 2 (contextIndex=1, không control) -> user_request + session_memory, không datasets đầy đủ', async () => {
    const s = new Session('r6', 8, undefined, 'rlm')
    s.extension('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 })).contextIndex = 1
    const p = await prepareRlmTurn({ session: s, input: { message: 'tiếp' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })
    expect((p.context as any).type).toBe('user_request')
    expect((p.context as any).session_memory).toBeDefined()
  })
  it('pendingControl + có skill -> selected_skill bị ép undefined (ưu tiên human_response)', async () => {
    const s = new Session('r7', 8, undefined, 'rlm')
    const st = s.extension<any>('loop:rlm', () => ({ contextIndex: 1, historyIndex: 0 }))
    st.pendingControl = { kind: 'ask' }
    const p = await prepareRlmTurn({ session: s, input: { message: 'ok' }, memory: fakeMemory(), workspace: fakeWorkspace(), skill: { name: 'w', description: 'd', instructions: 'i' } as any, tools: [], prompts: fakePrompts() })
    expect((p.context as any).selected_skill).toBeUndefined()
    expect(p.pendingControl).toEqual({ kind: 'ask' })
  })
  it('memory.snapshot throw -> lan ra ngoài (không swallow)', async () => {
    const s = new Session('r8', 8, undefined, 'rlm')
    await expect(prepareRlmTurn({ session: s, input: { message: 'x' }, memory: fakeMemory({ snapshot: async () => { throw new Error('snap down') } }), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })).rejects.toThrow(/snap down/)
  })
  it('workspace.resources thiếu -> degrade về [] thay vì TypeError (self-improve)', async () => {
    let got: any
    const s = new Session('r9', 8, undefined, 'rlm')
    const mem = fakeMemory({ snapshot: async (_id: string, o: any) => (got = o, { summary: '', turns: [], resources: { datasets: [], artifacts: [] } }) })
    await expect(prepareRlmTurn({ session: s, input: { message: 'x' }, memory: mem, workspace: { datasets: [] } as any, tools: [], prompts: fakePrompts() })).resolves.toBeDefined()
    expect(got.activeDatasets).toEqual([]); expect(got.artifacts).toEqual([])
  })
  it('promptVersion là version sau inject identity (hash 12-hex), prompt chứa Environment', async () => {
    const s = new Session('r10', 8, undefined, 'rlm')
    const p = await prepareRlmTurn({ session: s, input: { message: 'x' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts('HEAD\n\nTAIL') })
    expect(p.promptVersion).toMatch(/^[a-f0-9]{12}$/)
    expect(p.prompt).toContain('## Environment')
    expect(p.prompt.indexOf('## Environment')).toBeLessThan(p.prompt.indexOf('TAIL'))
  })
  it('lastError code lạ + message lạ -> health note fallback WORKER', async () => {
    const s = new Session('r11', 8, undefined, 'rlm')
    s.extension<RlmSessionState>('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 })).lastError = { code: 'BOGUS', message: '???' }
    const p = await prepareRlmTurn({ session: s, input: { message: 'x' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })
    expect(p.prompt).toContain('WORKER')
  })
  it('contextIndex âm (state bẩn) -> contract throw (integer minimum 0)', async () => {
    const s = new Session('r12', 8, undefined, 'rlm')
    s.extension('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 })).contextIndex = -1
    await expect(prepareRlmTurn({ session: s, input: { message: 'x' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })).rejects.toThrow()
  })
})

describe('R2 toStep mapping mọi event type (qua runTurn thật)', () => {
  async function runWith(events: any[]) {
    const mem = { state: 'completed', request: 'q', outcome: 'done', trajectory: {}, context_index: 0, history_index: 0, next_context_index: 1, next_history_index: 1 }
    const { root, base } = rlmStack(() => [...events, { type: '__result__', status: 'completed', answer: 'done', memory: mem }])
    await settle()
    const steps: string[] = []
    root.on('agent/step', ({ step }) => steps.push(step.type))
    const s = new Session(`rlm-t-${Math.random().toString(36).slice(2)}`, 8, undefined, 'rlm')
    const r = await root.agent.runTurn('rlm', s, 'q')
    const stored = (await root.storage.readEvents(s.id)).map((e) => e.type)
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
    return { steps, stored, result: r }
  }
  it('turn_started/iteration_started/iteration_completed/analysis/final', async () => {
    const { steps, result } = await runWith([
      { type: 'turn_started', run_id: 'r1', context_index: 3 },
      { type: 'iteration_started', iteration: 1, depth: 2 },
      { type: 'analysis', content: 'phân tích', iteration: 1, decision_summary: 'd' },
      { type: 'iteration_completed', iteration: 1, duration: 0.5 },
      { type: 'final_answer', content: 'done' },
    ])
    expect(steps).toEqual(expect.arrayContaining(['turn_started', 'iteration_started', 'analysis', 'iteration_completed', 'final', 'memory_updated']))
    expect(result.steps).toBe(1)
  })
  it('skill_loaded/skill_resource/workspace_read/workspace_write/code/observation', async () => {
    const { steps, stored } = await runWith([
      { type: 'skill_loaded', skill: 'wf' },
      { type: 'skill_resource', skill: 'wf', path: 'r.md', encoding: 'utf-8' },
      { type: 'workspace_read', action: 'read', path: 'a.csv' },
      { type: 'workspace_write', path: 'generated/out.csv' },
      { type: 'code', code: 'x=1', iteration: 2, block: 0 },
      { type: 'observation', stdout: 'o', stderr: 'e', success: false, iteration: 2, block: 0 },
    ])
    for (const t of ['skill_loaded', 'skill_resource', 'workspace_read', 'workspace_write', 'code', 'observation']) {
      expect(steps).toContain(t); expect(stored).toContain(t)
    }
  })
  it('tool_call/tool_result/subcall_result/context_usage/memory_updated/human_decision/error passthrough', async () => {
    const { steps } = await runWith([
      { type: 'tool_call', name: 't', args: { a: 1 } },
      { type: 'tool_result', name: 't', result: { ok: 1 } },
      { type: 'subcall_result', foo: 'bar' },
      { type: 'context_usage', pct: 10 },
      { type: 'memory_updated', q: 'x' },
      { type: 'human_decision', action: 'approve' },
      { type: 'error', message: 'non-fatal note' },
    ])
    for (const t of ['tool_call', 'tool_result', 'subcall_result', 'context_usage', 'memory_updated', 'human_decision', 'error']) {
      expect(steps).toContain(t)
    }
  })
  it('bug user báo: skill_resource path nhúng nhãn nội bộ -> storage + live đều sạch', async () => {
    const dirty = 'references/kpi-framework.md.\n[tool_call:web_search({"query":"đối thủ cạnh tranh FPT Telecom 2025","limit":10})]'
    const { root, base } = rlmStack(() => [
      { type: 'skill_resource', skill: 'business-case-builder', path: dirty },
      { type: 'final_answer', content: 'ok' },
      { type: '__result__', status: 'completed', answer: 'ok' },
    ])
    await settle()
    const live: any[] = []
    root.on('agent/step', ({ step }) => live.push(step))
    const s = new Session(`rlm-dirty-${Math.random().toString(36).slice(2)}`, 8, undefined, 'rlm')
    await root.agent.runTurn('rlm', s, 'q')
    const stored = (await root.storage.readEvents(s.id)).find((e) => e.type === 'skill_resource') as any
    expect(stored.path).toBe('references/kpi-framework.md.')
    expect(JSON.stringify(stored)).not.toContain('[tool_call:')
    const liveStep = live.find((x) => x.type === 'skill_resource') as any
    expect(liveStep.path).toBe('references/kpi-framework.md.')
    // Mô tả UI dựng từ event sạch sẽ không còn rác (đúng ca user gặp).
    expect(`Đọc ${liveStep.skill}/${liveStep.path}.`).not.toContain('[tool_call:')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('analysis/final_answer nhúng nhãn -> strip, code/observation giữ nguyên verbatim', async () => {
    const { root, base } = rlmStack(() => [
      { type: 'analysis', content: 'nghĩ [tool_call:t({"a":1})] tiếp', iteration: 1 },
      { type: 'code', code: 'x = "[tool_call:t({})]"  # data, giữ nguyên', iteration: 1 },
      { type: 'observation', stdout: '[tool_call:t({})]', stderr: '', success: true, iteration: 1 },
      { type: 'final_answer', content: 'chốt [tool_call:t({})] nhé' },
      { type: '__result__', status: 'completed', answer: 'chốt [tool_call:t({})] nhé' },
    ])
    await settle()
    const live: any[] = []
    root.on('agent/step', ({ step }) => live.push(step))
    const s = new Session(`rlm-strip2-${Math.random().toString(36).slice(2)}`, 8, undefined, 'rlm')
    const r = await root.agent.runTurn('rlm', s, 'q')
    expect(live.find((x) => x.type === 'analysis').content).toBe('nghĩ  tiếp')
    expect(r.content).toBe('chốt  nhé')
    const stored = await root.storage.readEvents(s.id)
    expect((stored.find((e) => e.type === 'code') as any).code).toContain('[tool_call:')
    expect((stored.find((e) => e.type === 'observation') as any).stdout).toContain('[tool_call:')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('event thiếu field -> default êm ("" / 0 / false), không throw', async () => {
    const { result } = await runWith([{ type: 'code' }, { type: 'observation' }, { type: 'tool_call' }, { type: 'error' }, { type: 'final_answer' }])
    expect(result.content).toBe('done')
  })
  it('iteration_completed nhiều lần -> steps đếm đúng', async () => {
    const { result } = await runWith([
      { type: 'iteration_completed', iteration: 1 }, { type: 'iteration_completed', iteration: 2 }, { type: 'iteration_completed', iteration: 3 },
      { type: 'final_answer', content: 'done' },
    ])
    expect(result.steps).toBe(3)
  })
})

describe('R3 workspaceActivities mọi pattern', () => {
  async function codeSteps(code: string) {
    const { root, base } = rlmStack(() => [
      { type: 'code', code, iteration: 1 },
      { type: 'final_answer', content: 'done' },
      { type: '__result__', status: 'completed', answer: 'done' },
    ])
    await settle()
    const steps: any[] = []
    root.on('agent/step', ({ step }) => steps.push(step))
    await root.agent.runTurn('rlm', new Session(`w-${Math.random().toString(36).slice(2)}`, 8, undefined, 'rlm'), 'q')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
    return steps.filter((s) => s.type === 'workspace_read' || s.type === 'workspace_write')
  }
  it('load_dataset/profile_dataset/list_workspace_files/list_datasets', async () => {
    const acts = await codeSteps(`load_dataset('a.csv')\nprofile_dataset('a.csv')\nlist_workspace_files()\nlist_datasets()`)
    expect(acts.some((a) => a.action === 'load dataset')).toBe(true)
    expect(acts.some((a) => a.action === 'list files')).toBe(true)
    expect(acts.some((a) => a.action === 'list datasets')).toBe(true)
  })
  it('read_workspace_file/pd.read_csv/open(...,"r")', async () => {
    const acts = await codeSteps(`read_workspace_file('x.csv')\nimport pandas as pd\ndf=pd.read_csv('y.csv')\nopen('z.txt','r')`)
    expect(acts.filter((a) => a.type === 'workspace_read').length).toBeGreaterThanOrEqual(3)
  })
  it('save_artifact/df.to_csv/open(...,"w") -> workspace_write', async () => {
    const acts = await codeSteps(`save_artifact('o.csv', df)\ndf.to_csv('p.csv')\nopen('q.txt','w')`)
    expect(acts.filter((a) => a.type === 'workspace_write').length).toBe(3)
  })
  it('code trùng lặp cùng file 2 lần -> dedupe 1 workspace_read', async () => {
    const acts = await codeSteps(`read_workspace_file('same.csv')\nread_workspace_file('same.csv')`)
    expect(acts.filter((a) => a.type === 'workspace_read' && a.path === 'same.csv')).toHaveLength(1)
  })
  it('code rỗng/không helper -> không sinh activity, turn vẫn xong', async () => {
    expect(await codeSteps('x = 1 + 1')).toHaveLength(0)
    expect(await codeSteps('')).toHaveLength(0)
  })
  it('code không phải string (số) -> String() êm, không throw', async () => {
    const { root, base } = rlmStack(() => [
      { type: 'code', code: 42, iteration: 1 },
      { type: 'final_answer', content: 'done' },
      { type: '__result__', status: 'completed', answer: 'done' },
    ])
    await settle()
    await expect(root.agent.runTurn('rlm', new Session('wnum', 8, undefined, 'rlm'), 'q')).resolves.toBeDefined()
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
})

describe('R4 sandbox/turnMemory/workspace failures + control/memory paths', () => {
  it('sandbox.openSession throw -> turn fail + error event', async () => {
    class BadOpen extends SandboxService {
      async run(): Promise<SandboxRunResult> { return { stdout: '', stderr: '', exitCode: 0 } }
      async openSession(): Promise<void> { throw new Error('open failed: no runtime') }
      async *request(): AsyncIterable<any> { yield { type: '__result__', status: 'completed', answer: 'never' } }
      async closeSession() {}
    }
    const base = tmpBase()
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry); root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
    root.plugin(stateSqlite, { path: ':memory:' })
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'h' } } }
    root.plugin(L); root.plugin(contextCompactorLlm)
    root.plugin(memoryRolling, { basePath: path.join(base, 'mem') })
    root.plugin(StubWorkspace as any, base)
    root.plugin(BadOpen as any)
    root.plugin(loopRegistry); root.plugin(loopRlm); root.plugin(agentRunner)
    await settle()
    const s = new Session('rf1', 8, undefined, 'rlm')
    await expect(root.agent.runTurn('rlm', s, 'q')).rejects.toThrow(/open failed/)
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('sandbox stream rỗng (0 event) -> throw missing result', async () => {
    const { root, base } = rlmStack(() => [])
    await settle()
    await expect(root.agent.runTurn('rlm', new Session('rf2', 8, undefined, 'rlm'), 'q')).rejects.toThrow(/without a turn result/)
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('status=waiting_user + control -> result giữ control, session KHÔNG recordAssistant', async () => {
    const { root, base } = rlmStack(() => [
      { type: '__result__', status: 'waiting_user', answer: 'need input', control: { kind: 'ask', q: 'tiếp?' } },
    ])
    await settle()
    const s = new Session('rf3', 8, undefined, 'rlm')
    const r = await root.agent.runTurn('rlm', s, 'q')
    expect(r.status).toBe('waiting_user'); expect(r.control).toEqual({ kind: 'ask', q: 'tiếp?' })
    expect(s.history.some((m) => m.content === 'need input')).toBe(false)
    expect(s.extension<any>('loop:rlm', () => ({})).pendingControl).toEqual({ kind: 'ask', q: 'tiếp?' })
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('memory rỗng (không có context_index...) -> bỏ qua recordContext/completeTurn? vẫn xong', async () => {
    const { root, base } = rlmStack(() => [{ type: 'final_answer', content: 'ok' }, { type: '__result__', status: 'completed', answer: 'ok', memory: {} }])
    await settle()
    expect((await root.agent.runTurn('rlm', new Session('rf4', 8, undefined, 'rlm'), 'q')).content).toBe('ok')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('completeTurn throw -> turn fail (không swallow)', async () => {
    const base = tmpBase()
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry); root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
    root.plugin(stateSqlite, { path: ':memory:' })
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'h' } } }
    root.plugin(L); root.plugin(contextCompactorLlm)
    class BadMem extends TurnMemoryService {
      async snapshot() { return { summary: '', turns: [], resources: { datasets: [], artifacts: [] } } }
      async summary() { return '' }
      async sourceContexts() { return [] }
      async recordContext() {}
      async recordTurn() { return {} }
      async completeTurn(): Promise<never> { throw new Error('completeTurn backend down') }
      async clear() {}
    }
    root.plugin(BadMem)
    root.plugin(StubWorkspace as any, base)
    root.plugin((ctx: Context) => { ctx.plugin(ScriptSandbox as any, () => doneResult('ok')) })
    root.plugin(loopRegistry); root.plugin(loopRlm); root.plugin(agentRunner)
    await settle()
    await expect(root.agent.runTurn('rlm', new Session('rf5', 8, undefined, 'rlm'), 'q')).rejects.toThrow(/completeTurn/)
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('turn 2: router query kèm [Session summary] từ turn 1 (rlm không mù)', async () => {
    const queries: string[] = []
    class CapSel extends SkillSelectionService {
      async select(message: string) { queries.push(message); return {} }
    }
    const { root, base } = rlmStack(() => doneResult('ok'), { skillSel: CapSel })
    await settle()
    const s = new Session(`rlm-rctx-${Math.random().toString(36).slice(2)}`, 8, undefined, 'rlm')
    await root.agent.runTurn('rlm', s, 'phân tích cohort retention')
    await root.agent.runTurn('rlm', s, 'làm tiếp')
    expect(queries).toHaveLength(2)
    expect(queries[0]).toBe('phân tích cohort retention') // turn đầu chưa có summary
    expect(queries[1]).toContain('[Session summary]')
    expect(queries[1]).toContain('[Current request]\nlàm tiếp')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('skill explicit trigger preload + semantic selector khi không match', async () => {
    class Sel extends SkillSelectionService {
      async select() { return { skill: { name: 'sem', description: 'd', instructions: 'SEM-INS', triggers: [], userInvocable: true } as any } }
    }
    const { root, base } = rlmStack(() => doneResult('ok'), { skillSel: Sel })
    await settle()
    root.skills.register({ name: 'trig', description: 'd', instructions: 'TRIG', triggers: ['cohort'], userInvocable: true })
    const s = new Session('rf6', 8, undefined, 'rlm')
    await root.agent.runTurn('rlm', s, 'cohort retention please')
    expect((await root.storage.readEvents(s.id)).some((e) => (e as any).type === 'skill_loaded' && (e as any).skill === 'trig')).toBe(true)
    const s2 = new Session('rf6b', 8, undefined, 'rlm')
    await root.agent.runTurn('rlm', s2, 'câu không khớp gì cả xyz')
    expect((await root.storage.readEvents(s2.id)).some((e) => (e as any).type === 'skill_loaded' && (e as any).skill === 'sem')).toBe(true)
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('workspace-local thật: inspect rỗng + turn chạy end-to-end', async () => {
    const base = tmpBase()
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry); root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
    root.plugin(stateSqlite, { path: ':memory:' })
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'h' } } }
    root.plugin(L); root.plugin(contextCompactorLlm)
    root.plugin(memoryRolling, { basePath: path.join(base, 'mem') })
    root.plugin(workspaceLocal, { basePath: base })
    root.plugin((ctx: Context) => { ctx.plugin(ScriptSandbox as any, () => doneResult('real-ws-ok')) })
    root.plugin(loopRegistry); root.plugin(loopRlm); root.plugin(agentRunner)
    await settle()
    const r = await root.agent.runTurn('rlm', new Session('rf7', 8, undefined, 'rlm'), 'q')
    expect(r.content).toBe('real-ws-ok')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('turn thất bại trước đó -> turn sau prompt chứa Session health (state.lastError lan)', async () => {
    const seen: any[] = []
    const { root, base } = rlmStack((p) => {
      seen.push(p)
      return doneResult('ok2')
    })
    await settle()
    const s = new Session('rf8', 8, undefined, 'rlm')
    s.extension<RlmSessionState>('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 })).lastError = { code: 'CODE_RUNTIME', message: 'boom-cell' }
    await root.agent.runTurn('rlm', s, 'tiếp')
    expect(String((seen[0] as any).prompt)).toContain('Session health notice')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('skillSelection throw trong rlm -> turn vẫn xong + event outcome=error', async () => {
    class BadSel extends SkillSelectionService {
      async select(): Promise<never> { throw new Error('rlm router down') }
    }
    const { root, base } = rlmStack(() => doneResult('rlm-ok'), { skillSel: BadSel })
    await settle()
    const s = new Session('rf10', 8, undefined, 'rlm')
    const r = await root.agent.runTurn('rlm', s, 'q')
    expect(r.content).toBe('rlm-ok')
    const ev = (await root.storage.readEvents(s.id)).find((e) => (e as any).type === 'skill_selection') as any
    expect(ev.outcome).toBe('error'); expect(ev.error).toContain('rlm router down')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('usage/trace_path passthrough từ __result__ ra LoopTurnResult', async () => {
    const { root, base } = rlmStack(() => [
      { type: 'final_answer', content: 'ok' },
      { type: '__result__', status: 'completed', answer: 'ok', usage: { calls: 5 }, trace_path: '/tmp/trace.jsonl' },
    ])
    await settle()
    const r = await root.agent.runTurn('rlm', new Session('rf9', 8, undefined, 'rlm'), 'q')
    expect(r.usage).toMatchObject({ calls: 5 }); expect(r.tracePath).toBe('/tmp/trace.jsonl')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
})
