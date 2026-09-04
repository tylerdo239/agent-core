// Ma trận kịch bản cho từng module nhỏ trong loop-default và loop-rlm.
// Mỗi module: input rỗng / quá dài / lỗi / thiếu provider / biên — kèm output mong muốn.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as loopRlm from '../bundles/loop-drivers/loop-rlm/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as promptRlmDataAgent from '../bundles/prompts/prompt-rlm-data-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import * as memoryRolling from '../bundles/providers/memory-rolling/index.ts'
import * as workspaceLocal from '../bundles/providers/workspace-local/index.ts'
import { LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'
import { ToolExecutionError } from '../seams/tools.ts'
import { SandboxRunResult, SandboxService } from '../seams/sandbox.ts'
import { TurnMemoryService } from '../seams/turn-memory.ts'
import { WorkspaceService } from '../seams/workspace.ts'
import { resolveActiveSkills, skillCatalogGuidance } from '../src/skill-runtime.ts'
import { environmentNote, injectEnvironmentNote } from '../src/environment-note.ts'
import { classifyError, inBandFeedback, isHarnessErrorCode, sessionHealthNote } from '../src/errors.ts'
import { repairLeakedToolCallLabel } from '../src/leaked-tool-call-label.ts'
import { prepareRlmTurn, RlmSessionState } from '../bundles/loop-drivers/loop-rlm/protocol.ts'

const settle = () => new Promise((r) => setTimeout(r, 15))
const tmpBase = () => mkdtempSync(path.join(os.tmpdir(), 'loop-matrix-'))

// ── M1: Session ──────────────────────────────────────────────
describe('M1 Session.buildPrompt/currentPrompt/record*/trim/extension', () => {
  it('input rỗng ("") -> vẫn push user msg rỗng, prompt merge 1 system duy nhất', () => {
    const s = new Session('m1-empty', 8, 'sys0')
    const msgs = s.buildPrompt('', [], 'fw')
    expect(msgs[0].role).toBe('system')
    expect(msgs.filter((m) => m.role === 'system')).toHaveLength(1)
    expect(msgs.at(-1)).toEqual({ role: 'user', content: '' })
  })
  it('input quá dài (200k chars) -> không throw, history vẫn trim đúng maxHistoryMessages', () => {
    const s = new Session('m1-long', 8, undefined, 'default', 5)
    const long = 'x'.repeat(200_000)
    s.buildPrompt(long)
    expect(s.history.length).toBeLessThanOrEqual(5)
    expect(s.history.at(-1)!.content).toBe(long)
  })
  it('nhiều system notes -> gộp đúng 1 system message, không sinh system thứ 2', () => {
    const s = new Session('m1-merge', 8, 'base-sys')
    const msgs = s.buildPrompt('hi', ['note1', 'note2', '', 'note3'], 'fw-sys')
    const systems = msgs.filter((m) => m.role === 'system')
    expect(systems).toHaveLength(1)
    for (const n of ['base-sys', 'fw-sys', 'note1', 'note2', 'note3']) {
      expect(systems[0].content).toContain(n)
    }
  })
  it('recordAssistant có toolCall -> prefix [tool_call:name(args)] để repair sau này', () => {
    const s = new Session('m1-label')
    s.recordAssistant('hello', { name: 't', args: { a: 1 } })
    expect(s.history.at(-1)!.content).toContain('[tool_call:t(')
  })
  it('recordToolResult lỗi object -> serialize JSON, không throw', () => {
    const s = new Session('m1-toolerr')
    expect(() => s.recordToolResult('t', { error: 'x', code: 'TOOL_EXEC' })).not.toThrow()
    expect(s.history.at(-1)!.content).toContain('"code":"TOOL_EXEC"')
  })
  it('replaceHistory + extension scope theo session', () => {
    const s = new Session('m1-ext')
    s.replaceHistory([{ role: 'user', content: 'a' }])
    expect(s.history).toHaveLength(1)
    const st = s.extension('k', () => ({ n: 0 }))
    st.n = 7
    expect(s.extension('k', () => ({ n: 0 })).n).toBe(7)
  })
})

// ── M2: resolveActiveSkills ──────────────────────────────────
describe('M2 resolveActiveSkills', () => {
  function ctxWithSkills() {
    const root = new Context()
    root.plugin(skillRegistry)
    return root
  }
  it('selectedSkill hợp lệ -> source=selected', async () => {
    const root = ctxWithSkills(); await settle()
    root.skills.register({ name: 's1', description: 'd', instructions: 'i', triggers: [], userInvocable: true })
    const out = resolveActiveSkills(root.skills, 'bất kỳ', 's1')
    expect(out).toHaveLength(1); expect(out[0].source).toBe('selected')
    await root.fiber.dispose()
  })
  it('selectedSkill rỗng/undefined + message rỗng -> trả [] chứ không throw', async () => {
    const root = ctxWithSkills(); await settle()
    expect(resolveActiveSkills(root.skills, '', undefined)).toEqual([])
    await root.fiber.dispose()
  })
  it('selectedSkill không tồn tại -> throw kèm danh sách available', async () => {
    const root = ctxWithSkills(); await settle()
    root.skills.register({ name: 'real', description: 'd', instructions: 'i', triggers: [], userInvocable: true })
    expect(() => resolveActiveSkills(root.skills, 'x', 'ghost')).toThrow(/not user-invocable/)
    await root.fiber.dispose()
  })
  it('selectedSkill tồn tại nhưng userInvocable=false -> throw', async () => {
    const root = ctxWithSkills(); await settle()
    root.skills.register({ name: 'priv', description: 'd', instructions: 'i', triggers: [], userInvocable: false })
    expect(() => resolveActiveSkills(root.skills, 'x', 'priv')).toThrow()
    await root.fiber.dispose()
  })
  it('message quá dài (100k) + trigger khớp -> vẫn match, không treo', async () => {
    const root = ctxWithSkills(); await settle()
    root.skills.register({ name: 'net', description: 'd', instructions: 'i', triggers: ['khiếu nại'], userInvocable: true })
    const out = resolveActiveSkills(root.skills, 'khiếu nại ' + 'z'.repeat(100_000))
    expect(out[0].skill.name).toBe('net'); expect(out[0].source).toBe('trigger')
    await root.fiber.dispose()
  })
})

// ── M3: skillCatalogGuidance ─────────────────────────────────
describe('M3 skillCatalogGuidance', () => {
  it('catalog rỗng -> trả "" (không chèn rác vào prompt)', () => {
    expect(skillCatalogGuidance([], undefined, true)).toBe('')
  })
  it('có catalog + selectedSkill -> rule ưu tiên explicit', () => {
    const out = skillCatalogGuidance([{ name: 'a', description: 'd' } as any], 'a', true)
    expect(out).toContain('explicitly selected "a"')
  })
  it('có catalog, không selected, có semantic loader -> hướng dẫn dùng tool skill', () => {
    const out = skillCatalogGuidance([{ name: 'a', description: 'd' } as any], undefined, true)
    expect(out).toContain('use the `skill` tool')
  })
  it('không có semantic loader -> rule catalog-only', () => {
    const out = skillCatalogGuidance([{ name: 'a', description: 'd' } as any], undefined, false)
    expect(out).toContain('catalog only')
  })
})

// ── M4: environmentNote ──────────────────────────────────────
describe('M4 environmentNote/injectEnvironmentNote', () => {
  it('note chứa currentYear/lastYear tính sẵn, không để model tự parse', () => {
    const n = environmentNote(new Date('2026-03-01T00:00:00Z'))
    expect(n).toContain('current year is 2026')
    expect(n).toContain('2026')
    expect(n).toContain('năm nay')
  })
  it('position=end -> append cuối; version hash lại 12 hex', () => {
    const out = injectEnvironmentNote({ content: 'base', version: 'old' }, 'end', new Date('2026-01-01T00:00:00Z'))
    expect(out.content.startsWith('base')).toBe(true)
    expect(out.content).toContain('## Environment')
    expect(out.version).toMatch(/^[a-f0-9]{12}$/)
  })
  it('position=identity + prompt rỗng -> không mất note', () => {
    const out = injectEnvironmentNote({ content: '', version: 'v' }, 'identity')
    expect(out.content).toContain('## Environment')
  })
  it('position=identity + prompt dài -> chèn sau đoạn identity đầu, giữ phần còn lại', () => {
    const long = 'identity-line\n\n' + 'body '.repeat(5000)
    const out = injectEnvironmentNote({ content: long, version: 'v' }, 'identity')
    expect(out.content).toContain('body')
    expect(out.content.indexOf('## Environment')).toBeLessThan(out.content.indexOf('body'))
  })
})

// ── M5: errors taxonomy ──────────────────────────────────────
describe('M5 classifyError/sessionHealthNote/inBandFeedback', () => {
  it.each([
    ['Rate limit 429 from llm provider', 'LLM_PROVIDER'],
    ['worker crashed unexpectedly', 'WORKER'],
    ['contract validation failed for prepared turn', 'CONTRACT'],
    ['session "x" exceeded maxSteps (25)', 'CONTEXT_OVERFLOW'],
    ["Traceback (most recent call last): ZeroDivisionError", 'CODE_RUNTIME'],
    ['tool "ghost" not found', 'TOOL_NOT_FOUND'],
    ['run cancelled by user', 'CANCELLED'],
    ['timed out after 5000ms', 'TIMEOUT'],
    ['totally unknown gibberish xyz', 'WORKER'], // fallback mặc định
  ])('classify "%s" -> %s', (msg, code) => {
    expect(classifyError(msg)).toBe(code)
  })
  it('input rỗng -> fallback WORKER, không throw', () => {
    expect(classifyError('')).toBe('WORKER')
  })
  it('input quá dài (50k) -> vẫn classify nhanh, không throw', () => {
    expect(() => classifyError('Traceback ' + 'x'.repeat(50_000))).not.toThrow()
  })
  it('sessionHealthNote rỗng/undefined -> "" (không chèn note rác)', () => {
    expect(sessionHealthNote(undefined)).toBe('')
    expect(sessionHealthNote({ message: '' })).toBe('')
  })
  it('sessionHealthNote lỗi thật -> chứa mã + guidance', () => {
    const n = sessionHealthNote({ code: 'CODE_RUNTIME', message: 'boom' })
    expect(n).toContain('CODE_RUNTIME')
    expect(n).toContain('Session health notice')
  })
  it('inBandFeedback recoverable=false -> có dòng not self-recoverable', () => {
    expect(inBandFeedback('LLM_PROVIDER', 'd')).toContain('not self-recoverable')
    expect(inBandFeedback('TOOL_ARGS')).not.toContain('not self-recoverable')
  })
  it('isHarnessErrorCode phân biệt mã lạ', () => {
    expect(isHarnessErrorCode('NO_PROGRESS')).toBe(true)
    expect(isHarnessErrorCode('HELLO')).toBe(false)
    expect(isHarnessErrorCode('')).toBe(false)
  })
})

// ── M6: repairLeakedToolCallLabel ────────────────────────────
describe('M6 repairLeakedToolCallLabel', () => {
  const exists = (n: string) => n === 'real_tool'
  it('đã có toolCall thật -> giữ nguyên', () => {
    const r = { content: 'x', toolCall: { name: 'a', args: {} } }
    expect(repairLeakedToolCallLabel(r, exists)).toBe(r)
  })
  it('label leak hợp lệ + tool tồn tại -> phục hồi toolCall, content=""', () => {
    const r = repairLeakedToolCallLabel({ content: '[tool_call:real_tool({"a":1})]' }, exists)
    expect(r.toolCall).toEqual({ name: 'real_tool', args: { a: 1 } })
    expect(r.content).toBe('')
  })
  it('tool không tồn tại -> giữ nguyên (không đoán bừa)', () => {
    const r = { content: '[tool_call:ghost({"a":1})]' }
    expect(repairLeakedToolCallLabel(r, exists).toolCall).toBeUndefined()
  })
  it('JSON args lỗi -> giữ nguyên', () => {
    const r = { content: '[tool_call:real_tool({broken)]' }
    expect(repairLeakedToolCallLabel(r, exists).toolCall).toBeUndefined()
  })
  it('args là array/null -> giữ nguyên', () => {
    expect(repairLeakedToolCallLabel({ content: '[tool_call:real_tool([1,2])]' }, exists).toolCall).toBeUndefined()
    expect(repairLeakedToolCallLabel({ content: '[tool_call:real_tool(null)]' }, exists).toolCall).toBeUndefined()
  })
  it('content rỗng / text thường -> giữ nguyên', () => {
    expect(repairLeakedToolCallLabel({ content: '' }, exists).toolCall).toBeUndefined()
    expect(repairLeakedToolCallLabel({ content: 'xin chào' }, exists).toolCall).toBeUndefined()
  })
  it('content quá dài chứa label ở giữa -> KHÔNG sửa (chỉ khớp chính xác toàn chuỗi)', () => {
    const r = repairLeakedToolCallLabel({ content: 'prefix [tool_call:real_tool({"a":1})] suffix' }, exists)
    expect(r.toolCall).toBeUndefined()
  })
})

// ── M7: loop-default runTurn ─────────────────────────────────
function defaultStack(llm: any) {
  const root = new Context()
  root.plugin(toolRegistry)
  root.plugin(skillRegistry)
  root.plugin(promptRegistry)
  root.plugin(promptDefaultAgent)
  root.plugin(contextCompactorLlm)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(llm)
  root.plugin(loopRegistry)
  root.plugin(loopDefault)
  root.plugin(agentRunner)
  return root
}
function addEchoTool(root: Context) {
  root.tools.add({
    name: 'echo', description: 'echo back',
    handler: async (args) => ({ echoed: (args as any).text ?? null }),
  })
}

describe('M7 loop-default: input biên + tool pipeline + điều khiển', () => {
  it('input rỗng -> turn vẫn chạy, trả final (không throw)', async () => {
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'nhận input rỗng' } } }
    const root = defaultStack(L); await settle()
    const s = new Session('d-empty')
    const r = await root.agent.runTurn('default', s, '')
    expect(r.content).toBe('nhận input rỗng'); expect(r.steps).toBe(0)
    await root.fiber.dispose()
  })
  it('input quá dài (100k, 1 message đơn) -> compactor cắt tại chỗ + turn vẫn xong (self-improve)', async () => {
    class L extends LlmService {
      async complete(): Promise<LlmCompletion> { return { content: 'đã xử lý input dài' } }
    }
    const root = defaultStack(L); await settle()
    // Sau fix: không còn throw 'no compactable history' — message đơn khổng lồ
    // được clip tại chỗ (kèm [truncated]) để turn tiếp tục thay vì fail cứng.
    const s = new Session('d-long')
    const r = await root.agent.runTurn('default', s, 'Q ' + 'x'.repeat(100_000))
    expect(r.content).toBe('đã xử lý input dài')
    expect(s.history.some((m) => m.content.includes('[truncated]'))).toBe(true)
    const evs = await root.storage.readEvents(s.id)
    expect(evs.some((e) => e.type === 'context_compacted')).toBe(true)
    await root.fiber.dispose()
  })
  it('tool throw ToolExecutionError từng mã -> error_class mapping đúng taxonomy', async () => {
    const cases: Array<[string, string]> = [
      ['TOOL_NOT_FOUND', 'TOOL_NOT_FOUND'], ['TOOL_ARGS_INVALID', 'TOOL_ARGS'],
      ['TOOL_PERMISSION_DENIED', 'TOOL_EXEC'], ['TOOL_TIMEOUT', 'TIMEOUT'],
      ['TOOL_CANCELLED', 'CANCELLED'], ['TOOL_HANDLER_ERROR', 'TOOL_EXEC'],
    ]
    for (const [code, expected] of cases) {
      class L extends LlmService {
        calls = 0
        async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
          if (!msgs.some((m) => m.role === 'tool')) return { content: 'go', toolCall: { name: 'boom', args: {} } }
          return { content: 'done' }
        }
      }
      const root = defaultStack(L); await settle()
      root.tools.add({ name: 'boom', description: 'b', handler: async () => { throw new ToolExecutionError(code as any, `fail ${code}`) } })
      const s = new Session(`d-tax-${code}`)
      const r = await root.agent.runTurn('default', s, 'test')
      expect(r.content).toBe('done')
      const ev = (await root.storage.readEvents(s.id)).find((e) => e.type === 'tool_result') as any
      expect(ev.result.error_class).toBe(expected)
      await root.fiber.dispose()
    }
  })
  it('tool không tồn tại -> tool_result lỗi, loop tiếp tục (không throw)', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'ghost', args: {} } }
        return { content: 'xong' }
      }
    }
    const root = defaultStack(L); await settle()
    const r = await root.agent.runTurn('default', new Session('d-ghost'), 'hi')
    expect(r.content).toBe('xong')
    await root.fiber.dispose()
  })
  it('model luôn gọi tool + maxSteps=1 -> throw NO_PROGRESS + ghi event error', async () => {
    class L extends LlmService {
      async complete(): Promise<LlmCompletion> { return { content: 'loop', toolCall: { name: 'echo', args: { text: 'a' } } } }
    }
    const root = defaultStack(L); await settle()
    addEchoTool(root)
    const s = new Session('d-max', 1)
    await expect(root.agent.runTurn('default', s, 'kẹt')).rejects.toThrow(/maxSteps/)
    const ev = await root.storage.readEvents(s.id)
    expect(ev.some((e) => e.type === 'error' && (e as any).error_code === 'NO_PROGRESS')).toBe(true)
    await root.fiber.dispose()
  })
  it('cancel giữa chừng (signal aborted) -> throw RunCancelled', async () => {
    class L extends LlmService {
      async complete(): Promise<LlmCompletion> { return { content: 'never' } }
    }
    const root = defaultStack(L); await settle()
    const c = new AbortController(); c.abort()
    await expect(root.agent.runTurn('default', new Session('d-cancel'), { message: 'hi', signal: c.signal })).rejects.toThrow()
    await root.fiber.dispose()
  })
  it('LLM provider throw -> ghi event error có error_code + rethrow', async () => {
    class L extends LlmService {
      async complete(): Promise<LlmCompletion> { throw new Error('llm provider 500 server error') } 
    }
    const root = defaultStack(L); await settle()
    const s = new Session('d-llmerr')
    await expect(root.agent.runTurn('default', s, 'hi')).rejects.toThrow()
    const ev = (await root.storage.readEvents(s.id)).find((e) => e.type === 'error') as any
    expect(ev.error_code).toBe('LLM_PROVIDER')
    await root.fiber.dispose()
  })
  it('usage cộng dồn qua nhiều step', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool'))
          return { content: 's1', toolCall: { name: 'echo', args: { text: 'a' } }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 1 } }
        return { content: 'final', usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, cost: 2 } }
      }
    }
    const root = defaultStack(L); await settle()
    addEchoTool(root)
    const r = await root.agent.runTurn('default', new Session('d-usage'), 'hi')
    expect(r.usage).toMatchObject({ inputTokens: 30, outputTokens: 10, totalTokens: 40, cost: 3 })
    await root.fiber.dispose()
  })
  it('thiếu prompt provider -> throw rõ ràng requires prompt', async () => {
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'x' } } }
    root.plugin(L); root.plugin(loopRegistry); root.plugin(loopDefault); root.plugin(agentRunner)
    await settle()
    await expect(root.agent.runTurn('default', new Session('d-noprompt'), 'hi')).rejects.toThrow(/requires prompt/)
    await root.fiber.dispose()
  })
})

// ── R1: prepareRlmTurn ───────────────────────────────────────
function fakeMemory() {
  return {
    snapshot: async () => ({ summary: 'sum', turns: [], currentContext: undefined, resources: { datasets: [], artifacts: [] } }),
    summary: async () => 'sum',
    sourceContexts: async () => [],
    recordContext: async () => {},
    recordTurn: async () => ({}),
    completeTurn: async (_s: string, input: any) => ({ update: { summary: 'u', turnSummary: 't' }, turn: { ok: 1, input } }),
    clear: async () => {},
  } as any
}
function fakePrompts(content = 'RLM base prompt\n\nSecond part') {
  return { render: () => ({ content, version: 'v'.repeat(12) }) } as any
}
function fakeWorkspace() {
  return { datasets: [{ id: 'd1' }], activeDataset: { id: 'd1' }, resources: { datasets: [{ id: 'd1' }], artifacts: ['a.csv'] } } as any
}

describe('R1 prepareRlmTurn (protocol)', () => {
  it('input rỗng -> request="" nhưng contract vẫn valid (contractVersion=2)', async () => {
    const s = new Session('r-empty', 8, undefined, 'rlm')
    const p = await prepareRlmTurn({ session: s, input: { message: '' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })
    expect(p.contractVersion).toBe(2); expect(p.request).toBe('')
    expect(p.prompt.length).toBeGreaterThan(0)
  })
  it('input quá dài (200k) -> request giữ nguyên, không cắt ngầm', async () => {
    const long = 'Q ' + 'y'.repeat(200_000)
    const s = new Session('r-long', 8, undefined, 'rlm')
    const p = await prepareRlmTurn({ session: s, input: { message: long }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })
    expect(p.request.length).toBe(long.length)
  })
  it('contextIndex=0 -> context.type=user_request kèm datasets; skill được gắn selected_skill', async () => {
    const s = new Session('r-skill', 8, undefined, 'rlm')
    const skill: any = { name: 'wf', description: 'd', instructions: 'do X', resources: ['r.md'] }
    const p = await prepareRlmTurn({ session: s, input: { message: 'hi' }, memory: fakeMemory(), workspace: fakeWorkspace(), skill, skillCatalog: [skill], tools: [{ name: 't', description: 'd' } as any], prompts: fakePrompts() })
    expect((p.context as any).type).toBe('user_request')
    expect((p.context as any).selected_skill.name).toBe('wf')
    expect((p.context as any).skill_catalog).toHaveLength(1)
  })
  it('pendingControl -> context.type=human_response + human_response.for trỏ đúng control', async () => {
    const s = new Session('r-ctrl', 8, undefined, 'rlm')
    s.extension<RlmSessionState>('loop:rlm', () => ({ contextIndex: 1, historyIndex: 1 })).pendingControl = { kind: 'ask' }
    // contextIndex phải >0 để đi nhánh human_response
    s.extension<any>('loop:rlm', () => ({})).contextIndex = 1
    const p = await prepareRlmTurn({ session: s, input: { message: 'đồng ý' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })
    expect((p.context as any).type).toBe('human_response')
    expect((p.context as any).human_response.for).toEqual({ kind: 'ask' })
  })
  it('lastError trước đó -> prompt kèm [SESSION HEALTH] note', async () => {
    const s = new Session('r-health', 8, undefined, 'rlm')
    s.extension<RlmSessionState>('loop:rlm', () => ({ contextIndex: 0, historyIndex: 0 })).lastError = { code: 'CODE_RUNTIME', message: 'boom' }
    const p = await prepareRlmTurn({ session: s, input: { message: 'tiếp' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: fakePrompts() })
    expect(p.prompt).toContain('Session health notice')
  })
  it('registry trả prompt rỗng -> injectEnvironmentNote vẫn bảo đảm prompt minLength 1 (contract không throw)', async () => {
    const s = new Session('r-badprompt', 8, undefined, 'rlm')
    // Hành vi thật: injectEnvironmentNote luôn append ## Environment nên finalPrompt
    // không bao giờ rỗng qua đường chuẩn — validator minLength(1) chỉ là lưới an toàn.
    const p = await prepareRlmTurn({ session: s, input: { message: 'x' }, memory: fakeMemory(), workspace: fakeWorkspace(), tools: [], prompts: { render: () => ({ content: '', version: 'v12345678901' }) } as any })
    expect(p.prompt).toContain('## Environment')
    expect(p.prompt.length).toBeGreaterThan(0)
  })
})

// ── R2: loop-rlm runTurn với FakeSandbox ─────────────────────
class ScriptSandbox extends SandboxService {
  constructor(ctx: any, public script: (payload: any) => any[]) { super(ctx) }
  async run(): Promise<SandboxRunResult> { return { stdout: '', stderr: '', exitCode: 0 } }
  async openSession() {}
  async *request(_sid: string, _op: string, payload: Record<string, unknown>) {
    for (const e of this.script(payload)) yield e
  }
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
  async promoteSessionOutput(w: string, r: string, s: string) { return { path: s, size: 0, mtime: '', sourcePath: s, createdBySession: r } }
}
function rlmStack(script: (payload: any) => any[]) {
  const base = tmpBase()
  const root = new Context()
  root.plugin(toolRegistry)
  root.plugin(skillRegistry)
  root.plugin(promptRegistry)
  root.plugin(promptRlmDataAgent)
  root.plugin(stateSqlite, { path: ':memory:' })
  class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'host' } } }
  root.plugin(L)
  root.plugin(contextCompactorLlm)
  root.plugin(memoryRolling, { basePath: path.join(base, 'mem') })
  root.plugin(StubWorkspace as any, base)
  root.plugin((ctx: Context) => { ctx.plugin(ScriptSandbox as any, script) })
  root.plugin(loopRegistry)
  root.plugin(loopRlm)
  root.plugin(agentRunner)
  return { root, base }
}

describe('R2 loop-rlm: sandbox bridge + toStep/workspaceActivities + trạng thái', () => {
  it('happy path: code có read_workspace_file/save_artifact -> sinh workspace_read/write trước event code', async () => {
    const { root, base } = rlmStack(() => [
      { type: 'code', code: `read_workspace_file('data.csv')\nsave_artifact('out.csv', df)`, iteration: 1 },
      { type: 'observation', stdout: 'ok', stderr: '', success: true, iteration: 1 },
      { type: 'iteration_completed', iteration: 1 },
      { type: 'final_answer', content: 'xong RLM' },
      { type: '__result__', status: 'completed', answer: 'xong RLM', usage: {}, memory: { state: 'completed', request: 'q', outcome: 'xong', trajectory: {}, context_index: 0, history_index: 0, next_context_index: 1, next_history_index: 1 } },
    ])
    await settle()
    const steps: string[] = []
    root.on('agent/step', ({ step }) => steps.push(step.type))
    const r = await root.agent.runTurn('rlm', new Session('rlm-happy', 8, undefined, 'rlm'), 'phân tích')
    expect(r.content).toBe('xong RLM'); expect(r.steps).toBe(1); expect(r.status).toBe('completed')
    expect(steps).toContain('workspace_read'); expect(steps).toContain('workspace_write')
    expect(steps.indexOf('workspace_read')).toBeLessThan(steps.indexOf('code'))
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('sandbox throw giữa chừng -> ghi error event có error_code + lưu lastError cho turn sau', async () => {
    const { root, base } = rlmStack(() => { throw new Error('worker crashed pipe broken') })
    await settle()
    const s = new Session('rlm-crash', 8, undefined, 'rlm')
    await expect(root.agent.runTurn('rlm', s, 'q')).rejects.toThrow()
    const ev = (await root.storage.readEvents(s.id)).find((e) => e.type === 'error') as any
    expect(ev.error_code).toBe('WORKER')
    expect(s.extension<any>('loop:rlm', () => ({})).lastError.code).toBe('WORKER')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('worker kết thúc không có __result__ -> throw ended without a turn result', async () => {
    const { root, base } = rlmStack(() => [{ type: 'final_answer', content: 'half' }])
    await settle()
    await expect(root.agent.runTurn('rlm', new Session('rlm-noresult', 8, undefined, 'rlm'), 'q')).rejects.toThrow(/without a turn result/)
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('status=failed + turn_issue CODE_PARSE -> lastError lưu đúng mã', async () => {
    const { root, base } = rlmStack(() => [
      { type: '__result__', status: 'failed', answer: 'fail', turn_issue: { code: 'CODE_PARSE', message: 'no fence' } },
    ])
    await settle()
    const s = new Session('rlm-failed', 8, undefined, 'rlm')
    const r = await root.agent.runTurn('rlm', s, 'q')
    expect(r.status).toBe('failed')
    expect(s.extension<any>('loop:rlm', () => ({})).lastError.code).toBe('CODE_PARSE')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('event lạ (unknown_type) -> bỏ qua êm, không crash turn', async () => {
    const { root, base } = rlmStack(() => [
      { type: 'weird_unknown_xyz', foo: 1 },
      { type: 'final_answer', content: 'ok' },
      { type: '__result__', status: 'completed', answer: 'ok' },
    ])
    await settle()
    const r = await root.agent.runTurn('rlm', new Session('rlm-unknown', 8, undefined, 'rlm'), 'q')
    expect(r.content).toBe('ok')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('input rỗng cho rlm -> vẫn prepare + chạy (request="")', async () => {
    let seenPayload: any
    const { root, base } = rlmStack((p) => {
      seenPayload = p
      return [{ type: 'final_answer', content: 'empty-ok' }, { type: '__result__', status: 'completed', answer: 'empty-ok' }]
    })
    await settle()
    const r = await root.agent.runTurn('rlm', new Session('rlm-empty', 8, undefined, 'rlm'), '')
    expect(r.content).toBe('empty-ok'); expect(seenPayload.request).toBe('')
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('thiếu sandbox provider -> throw requires sandbox...', async () => {
    const base = tmpBase()
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry); root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
    root.plugin(stateSqlite, { path: ':memory:' })
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'h' } } }
    root.plugin(L); root.plugin(contextCompactorLlm)
    root.plugin(memoryRolling, { basePath: path.join(base, 'mem') })
    root.plugin(StubWorkspace as any, base)
    root.plugin(loopRegistry); root.plugin(loopRlm); root.plugin(agentRunner)
    await settle()
    await expect(root.agent.runTurn('rlm', new Session('rlm-nosandbox', 8, undefined, 'rlm'), 'q')).rejects.toThrow(/requires sandbox/)
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
  it('cancel giữa stream sandbox -> throw cancellation', async () => {
    const { root, base } = rlmStack(async function* () {
      yield { type: 'iteration_started', iteration: 1 }
      await new Promise(() => {})
    } as any)
    await settle()
    const c = new AbortController(); c.abort()
    await expect(root.agent.runTurn('rlm', new Session('rlm-cancel', 8, undefined, 'rlm'), { message: 'q', signal: c.signal })).rejects.toThrow()
    await root.fiber.dispose(); rmSync(base, { recursive: true, force: true })
  })
})
