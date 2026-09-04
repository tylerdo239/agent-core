// Exhaustive loop-default: LLM biên + tool pipeline + memory/skillSelection/compaction
// + agent-runner kết nối (dedupe/serialize/cancel/drain) + events.
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { MemoryService } from '../seams/memory.ts'
import { SkillSelectionService } from '../seams/skill-selection.ts'
import { LoopStep, Session } from '../seams/loop.ts'
import { ToolExecutionError } from '../seams/tools.ts'

const settle = () => new Promise((r) => setTimeout(r, 15))
function stack(llm: any) {
  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry); root.plugin(promptRegistry)
  root.plugin(promptDefaultAgent); root.plugin(contextCompactorLlm)
  root.plugin(stateSqlite, { path: ':memory:' }); root.plugin(llm)
  root.plugin(loopRegistry); root.plugin(loopDefault); root.plugin(agentRunner)
  return root
}
class OkLlm extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'ok' } } }

describe('D1 LLM response biên', () => {
  it('content rỗng -> final rỗng, steps=0', async () => {
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: '' } } }
    const root = stack(L); await settle()
    const r = await root.agent.runTurn('default', new Session('d-e1'), 'hi')
    expect(r.content).toBe(''); expect(r.steps).toBe(0)
    await root.fiber.dispose()
  })
  it('content whitespace/emoji/unicode dài 50k -> giữ nguyên', async () => {
    const big = '😀'.repeat(10_000) + '中文'.repeat(5000)
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: big } } }
    const root = stack(L); await settle()
    expect((await root.agent.runTurn('default', new Session('d-e2'), 'hi')).content).toBe(big)
    await root.fiber.dispose()
  })
  it('toolCall name rỗng -> tool_result TOOL_NOT_FOUND, loop tiếp tục', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: '', args: {} } }
        return { content: 'done' }
      }
    }
    const root = stack(L); await settle()
    expect((await root.agent.runTurn('default', new Session('d-e3'), 'hi')).content).toBe('done')
    await root.fiber.dispose()
  })
  it('usage thiếu field/âm/khổng lồ -> cộng dồn số học thuần (không validate)', async () => {
    class L extends LlmService { async complete(): Promise<LlmCompletion> { return { content: 'x', usage: { inputTokens: -5 } as any } } }
    const root = stack(L); await settle()
    const r = await root.agent.runTurn('default', new Session('d-e4'), 'hi')
    expect((r.usage as any).inputTokens).toBe(-5)
    await root.fiber.dispose()
  })
  it('LLM trả toolCall args null (cast) -> invoke nhận null? AJV fail -> TOOL_ARGS/TOOL_HANDLER, turn vẫn xong', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'echo', args: null as any } }
        return { content: 'recovered' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'echo', description: 'e', handler: async () => 'never' })
    const s = new Session('d-e5')
    expect((await root.agent.runTurn('default', s, 'hi')).content).toBe('recovered')
    const ev = (await root.storage.readEvents(s.id)).find((e) => e.type === 'tool_result') as any
    expect(ev.result.code).toMatch(/TOOL_ARGS_INVALID|TOOL_HANDLER_ERROR/)
    await root.fiber.dispose()
  })
  it('bug user báo: model nhúng nhãn giữa content -> strip, final sạch (không gọi tool oan)', async () => {
    class L extends LlmService {
      async complete(): Promise<LlmCompletion> {
        return { content: 'Đã đọc xong tài liệu [tool_call:web_search({"query":"thị phần 2025"})] rồi kết luận: OK' }
      }
    }
    const root = stack(L); await settle()
    const s = new Session('d-leak-embed')
    const r = await root.agent.runTurn('default', s, 'hi')
    expect(r.content).toBe('Đã đọc xong tài liệu  rồi kết luận: OK')
    expect(JSON.stringify(await root.storage.readEvents(s.id))).not.toContain('[tool_call:')
    expect(s.history.every((m) => !m.content.includes('[tool_call:'))).toBe(true)
    await root.fiber.dispose()
  })
  it('chuỗi 3 tool steps -> steps=3, history roles đúng', async () => {
    let n = 0
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        const tools = msgs.filter((m) => m.role === 'tool').length
        if (tools < 3) return { content: `s${tools}`, toolCall: { name: 'echo', args: { i: tools } } }
        return { content: 'final3' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'echo', description: 'e', handler: async (a) => ({ a }) })
    const s = new Session('d-e6')
    const r = await root.agent.runTurn('default', s, 'go')
    expect(r.steps).toBe(3); expect(r.content).toBe('final3')
    expect(s.history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant'])
    expect(n).toBe(0)
    await root.fiber.dispose()
  })
  it('completeStream onDelta rỗng + trả toolCall -> vẫn invoke tool', async () => {
    class L extends LlmService {
      async complete(): Promise<LlmCompletion> { throw new Error('no-complete') }
      async completeStream(_m: any, _o: any, onDelta: any): Promise<LlmCompletion> {
        onDelta('')
        return { content: 'c', toolCall: { name: 'echo', args: {} } }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'echo', description: 'e', handler: async () => 1 })
    const steps: LoopStep[] = []
    root.on('agent/step', (e) => steps.push(e.step))
    const s = new Session('d-e7')
    // LLM stream luôn trả toolCall -> maxSteps mặc định 25 sẽ lặp; giới hạn session 1 để kết thúc nhanh
    s.maxSteps = 1
    await expect(root.agent.runTurn('default', s, 'hi')).rejects.toThrow(/maxSteps/)
    expect(steps.some((x) => x.type === 'token')).toBe(true)
    await root.fiber.dispose()
  })
  it('completeStream throw LlmError 429 -> event error LLM_PROVIDER + rethrow', async () => {
    class L extends LlmService {
      async complete(): Promise<LlmCompletion> { throw new Error('x') }
      async completeStream(): Promise<LlmCompletion> { throw new Error('llm provider 429 rate limit exceeded') }
    }
    const root = stack(L); await settle()
    const s = new Session('d-e8')
    await expect(root.agent.runTurn('default', s, 'hi')).rejects.toThrow(/429/)
    expect(((await root.storage.readEvents(s.id)).find((e) => e.type === 'error') as any).error_code).toBe('LLM_PROVIDER')
    await root.fiber.dispose()
  })
})

describe('D2 tool pipeline exhaustive', () => {
  it('schema strict: thiếu required/wrong type -> TOOL_ARGS_INVALID + error_class TOOL_ARGS', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'strict', args: { age: 'not-a-number' } } }
        return { content: 'done' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'strict', description: 's', parameters: { type: 'object', required: ['age'], properties: { age: { type: 'number' } } }, handler: async () => 'never' })
    const s = new Session('d-t1')
    await root.agent.runTurn('default', s, 'hi')
    const ev = (await root.storage.readEvents(s.id)).find((e) => e.type === 'tool_result') as any
    expect(ev.result.code).toBe('TOOL_ARGS_INVALID'); expect(ev.result.error_class).toBe('TOOL_ARGS')
    await root.fiber.dispose()
  })
  it('handler trả undefined/null/0/false/mảng lớn -> serialize vào tool_result', async () => {
    for (const v of [undefined, null, 0, false, Array.from({ length: 1000 }, (_, i) => i)]) {
      class L extends LlmService {
        async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
          if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'h', args: {} } }
          return { content: 'done' }
        }
      }
      const root = stack(L); await settle()
      root.tools.add({ name: 'h', description: 'h', handler: async () => v })
      const s = new Session(`d-t2-${String(v)?.length}`)
      await root.agent.runTurn('default', s, 'hi')
      expect((await root.storage.readEvents(s.id)).some((e) => e.type === 'tool_result')).toBe(true)
      await root.fiber.dispose()
    }
  })
  it('handler throw plain Error -> TOOL_HANDLER_ERROR + error_class TOOL_EXEC', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'boom', args: {} } }
        return { content: 'ok' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'boom', description: 'b', handler: async () => { throw new Error('plain handler failure') } })
    const s = new Session('d-t3')
    await root.agent.runTurn('default', s, 'hi')
    const ev = (await root.storage.readEvents(s.id)).find((e) => e.type === 'tool_result') as any
    expect(ev.result.code).toBe('TOOL_HANDLER_ERROR'); expect(ev.result.error_class).toBe('TOOL_EXEC')
    await root.fiber.dispose()
  })
  it('handler throw string (non-Error) -> vẫn bọc TOOL_HANDLER_ERROR', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'str', args: {} } }
        return { content: 'ok' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'str', description: 's', handler: async () => { throw 'string-boom' as any } })
    const s = new Session('d-t4')
    await root.agent.runTurn('default', s, 'hi')
    expect(((await root.storage.readEvents(s.id)).find((e) => e.type === 'tool_result') as any).result.code).toBe('TOOL_HANDLER_ERROR')
    await root.fiber.dispose()
  })
  it('tool timeoutMs=20 + handler 200ms -> TOOL_TIMEOUT + error_class TIMEOUT (tách riêng khỏi TOOL_EXEC)', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'slow', args: {} } }
        return { content: 'ok' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'slow', description: 's', timeoutMs: 20, handler: async () => { await new Promise((r) => setTimeout(r, 200)); return 1 } })
    const s = new Session('d-t5')
    await root.agent.runTurn('default', s, 'hi')
    const ev = (await root.storage.readEvents(s.id)).find((e) => e.type === 'tool_result') as any
    expect(ev.result.code).toBe('TOOL_TIMEOUT'); expect(ev.result.error_class).toBe('TIMEOUT')
    await root.fiber.dispose()
  })
  it('tool yêu cầu permissionAction nhưng không mount permission -> TOOL_PERMISSION_DENIED', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'guard', args: {} } }
        return { content: 'ok' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'guard', description: 'g', permissionAction: 'read-secret', handler: async () => 'never' })
    const s = new Session('d-t6')
    await root.agent.runTurn('default', s, 'hi')
    expect(((await root.storage.readEvents(s.id)).find((e) => e.type === 'tool_result') as any).result.code).toBe('TOOL_PERMISSION_DENIED')
    await root.fiber.dispose()
  })
  it('add tool trùng tên / schema invalid -> throw lúc đăng ký', async () => {
    const root = stack(OkLlm); await settle()
    root.tools.add({ name: 'dup', description: 'd', handler: async () => 1 })
    expect(() => root.tools.add({ name: 'dup', description: 'd', handler: async () => 1 })).toThrow(/already registered/)
    expect(() => root.tools.add({ name: 'bad', description: 'b', parameters: { type: 'weird-type' } as any, handler: async () => 1 })).toThrow(/invalid JSON Schema/)
    await root.fiber.dispose()
  })
  it('tool trực tiếp invoke: TOOL_NOT_FOUND / TOOL_CANCELLED (signal aborted) / deadline qua', async () => {
    const root = stack(OkLlm); await settle()
    root.tools.add({ name: 'e', description: 'e', handler: async () => 1 })
    await expect(root.tools.invoke('ghost', {}, { sessionId: 's', source: 'default-loop' })).rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' })
    const c = new AbortController(); c.abort()
    await expect(root.tools.invoke('e', {}, { sessionId: 's', source: 'default-loop', signal: c.signal })).rejects.toMatchObject({ code: 'TOOL_CANCELLED' })
    await expect(root.tools.invoke('e', {}, { sessionId: 's', source: 'default-loop', deadline: Date.now() - 1 })).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' })
    await root.fiber.dispose()
  })
})

describe('D3 memory/skillSelection/compaction kết nối', () => {
  it('không mount memory -> turn chạy bình thường, không recall', async () => {
    const root = stack(OkLlm); await settle()
    expect((await root.agent.runTurn('default', new Session('d-m1'), 'hi')).content).toBe('ok')
    await root.fiber.dispose()
  })
  it('memory.recall throw -> turn vẫn xong (degrade, self-improve)', async () => {
    class BadMem extends MemoryService {
      async remember(): Promise<void> {}
      async recall(): Promise<never> { throw new Error('recall backend down') }
    }
    const root = stack(OkLlm)
    root.plugin((ctx: Context) => { ctx.plugin(BadMem) })
    await settle()
    // Sau fix: recall sập không sập turn — đi tiếp không memory notes.
    const r = await root.agent.runTurn('default', new Session('d-m2'), 'hi')
    expect(r.content).toBe('ok')
    await root.fiber.dispose()
  })
  it('memory.recall trả entries thiếu text/rỗng -> chèn "Đã ghi nhớ trước đó: undefined"? không throw', async () => {
    class WeirdMem extends MemoryService {
      async remember(): Promise<void> {}
      async recall() { return [{ id: '1' } as any, { id: '2', text: '' }] }
    }
    let seen = ''
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> { seen = msgs[0].content; return { content: 'ok' } }
    }
    const root = stack(L)
    root.plugin((ctx: Context) => { ctx.plugin(WeirdMem) })
    await settle()
    await root.agent.runTurn('default', new Session('d-m3'), 'hi')
    expect(seen).toContain('Đã ghi nhớ trước đó')
    await root.fiber.dispose()
  })
  it('skillSelection throw -> turn vẫn xong + event outcome=error (degrade, self-improve)', async () => {
    class BadSel extends SkillSelectionService {
      async select(): Promise<never> { throw new Error('router down') }
    }
    const root = stack(OkLlm)
    root.plugin((ctx: Context) => { ctx.plugin(BadSel) })
    await settle()
    const s = new Session('d-s1')
    const r = await root.agent.runTurn('default', s, 'hi')
    expect(r.content).toBe('ok')
    const ev = (await root.storage.readEvents(s.id)).find((e) => (e as any).type === 'skill_selection') as any
    expect(ev.outcome).toBe('error'); expect(ev.error).toContain('router down')
    await root.fiber.dispose()
  })
  it('skillSelection trả skill ghost (không trong registry) -> vẫn load + ghi skill_loaded (ghi nhận)', async () => {
    class GhostSel extends SkillSelectionService {
      async select() { return { skill: { name: 'ghost-skill', description: 'd', instructions: 'do ghost', triggers: [], userInvocable: true } as any } }
    }
    const root = stack(OkLlm)
    root.plugin((ctx: Context) => { ctx.plugin(GhostSel) })
    await settle()
    const s = new Session('d-s2')
    await root.agent.runTurn('default', s, 'hi')
    expect((await root.storage.readEvents(s.id)).some((e) => (e as any).type === 'skill_loaded')).toBe(true)
    await root.fiber.dispose()
  })
  it('turn 2 "làm tiếp như trên": router query chứa history turn 1 + nhãn Current (không mù)', async () => {
    const queries: string[] = []
    class CapSel extends SkillSelectionService {
      async select(message: string) { queries.push(message); return {} }
    }
    class L extends LlmService {
      async complete(): Promise<LlmCompletion> { return { content: 'ok' } }
    }
    const root = stack(L)
    root.plugin((ctx: Context) => { ctx.plugin(CapSel) })
    await settle()
    const s = new Session('d-router-ctx')
    await root.agent.runTurn('default', s, 'phân tích cohort retention giúp tôi')
    await root.agent.runTurn('default', s, 'làm tiếp như trên')
    expect(queries).toHaveLength(2)
    expect(queries[0]).toBe('phân tích cohort retention giúp tôi') // turn đầu: nguyên message
    expect(queries[1]).toContain('[Recent conversation]')
    expect(queries[1]).toContain('phân tích cohort retention giúp tôi')
    expect(queries[1]).toContain('[Current request]\nlàm tiếp như trên')
    await root.fiber.dispose()
  })
  it('selectedSkill explicit ghost -> throw not user-invocable trước khi gọi LLM', async () => {
    const root = stack(OkLlm); await settle()
    await expect(root.agent.runTurn('default', new Session('d-s3'), { message: 'hi', selectedSkill: 'ghost' })).rejects.toThrow(/not user-invocable/)
    await root.fiber.dispose()
  })
  it('compaction path: history dài nhiều lượt tool -> context_compacted + prompt_assembled mỗi step', async () => {
    let turn = 0
    class L extends LlmService {
      async complete(msgs: LlmMessage[], opts: any = {}): Promise<LlmCompletion> {
        if (opts.purpose === 'memory') return { content: JSON.stringify({ prior_summary: 'S', progress_summary: 'P' }) }
        if (!msgs.some((m) => m.role === 'tool')) { turn++; return { content: 'c', toolCall: { name: 'echo', args: {} } } }
        return { content: 'final' }
      }
    }
    const root = new Context()
    root.plugin(toolRegistry); root.plugin(skillRegistry); root.plugin(promptRegistry); root.plugin(promptDefaultAgent)
    root.plugin(stateSqlite, { path: ':memory:' }); root.plugin(L)
    root.plugin(contextCompactorLlm, { contextLimitTokens: 2500, thresholdPct: 0.8 })
    root.plugin(loopRegistry); root.plugin(loopDefault); root.plugin(agentRunner)
    await settle()
    root.tools.add({ name: 'echo', description: 'e', handler: async () => 'v' })
    const s = new Session('d-c1', 8, undefined, 'default', 100)
    for (let i = 0; i < 10; i++) { s.history.push({ role: 'user', content: `old ${i} ${'x'.repeat(700)}` }); s.history.push({ role: 'assistant', content: `resp ${i} ${'y'.repeat(700)}` }) }
    await root.agent.runTurn('default', s, 'tiếp')
    const types = (await root.storage.readEvents(s.id)).map((e) => e.type)
    expect(types).toContain('context_compacted'); expect(types.filter((t) => t === 'prompt_assembled').length).toBeGreaterThanOrEqual(2)
    await root.fiber.dispose()
  })
})

describe('D4 agent-runner kết nối: dedupe/serialize/cancel/drain/driver', () => {
  it('driver không tồn tại -> throw rõ', async () => {
    const root = stack(OkLlm); await settle()
    await expect(root.agent.runTurn('nope', new Session('d-r1'), 'hi')).rejects.toThrow(/not found/)
    await root.fiber.dispose()
  })
  it('requestId trùng -> dedupe cùng promise/result', async () => {
    const root = stack(OkLlm); await settle()
    const s = new Session('d-r2')
    const p1 = root.agent.runTurn('default', s, { message: 'hi', requestId: 'req-1' })
    const p2 = root.agent.runTurn('default', s, { message: 'hi', requestId: 'req-1' })
    expect(await p1).toEqual(await p2)
    await root.fiber.dispose()
  })
  it('2 turn cùng session serialize (turn2 đợi turn1), khác session song song', async () => {
    const order: string[] = []
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        await new Promise((r) => setTimeout(r, 30))
        order.push(msgs[msgs.length - 1].content)
        return { content: 'ok' }
      }
    }
    const root = stack(L); await settle()
    const s = new Session('d-r3')
    await Promise.all([root.agent.runTurn('default', s, 'first'), root.agent.runTurn('default', s, 'second')])
    expect(order).toEqual(['first', 'second'])
    await Promise.all([root.agent.runTurn('default', new Session('pa'), 'a'), root.agent.runTurn('default', new Session('pb'), 'b')])
    await root.fiber.dispose()
  })
  it('cancel queued turn -> RunCancelledError', async () => {
    class Slow extends LlmService {
      async complete(): Promise<LlmCompletion> { await new Promise((r) => setTimeout(r, 200)); return { content: 'slow' } }
    }
    const root = stack(Slow); await settle()
    const s = new Session('d-r4')
    const c = new AbortController()
    const p = root.agent.runTurn('default', s, { message: 'hi', signal: c.signal })
    c.abort()
    await expect(p).rejects.toThrow()
    await root.fiber.dispose()
  })
  it('drain -> run mới bị reject', async () => {
    const root = stack(OkLlm); await settle()
    await root.agent.drain(10)
    await expect(root.agent.runTurn('default', new Session('d-r5'), 'hi')).rejects.toThrow(/draining/)
    await root.fiber.dispose()
  })
  it('turn-done/turn-error emit đúng 1 lần mỗi turn', async () => {
    const root = stack(OkLlm); await settle()
    let done = 0, err = 0
    root.on('agent/turn-done', () => done++); root.on('agent/turn-error', () => err++)
    await root.agent.runTurn('default', new Session('d-r6'), 'hi')
    class Bad extends LlmService { async complete(): Promise<LlmCompletion> { throw new Error('llm down 500 provider error') } }
    const root2 = stack(Bad); await settle()
    let err2 = 0
    root2.on('agent/turn-error', () => err2++)
    await expect(root2.agent.runTurn('default', new Session('d-r7'), 'hi')).rejects.toThrow()
    expect(done).toBe(1); expect(err).toBe(0); expect(err2).toBe(1)
    await root.fiber.dispose(); await root2.fiber.dispose()
  })
  it('input string thuần (không phải object) vẫn chạy qua normalizeTurnInput', async () => {
    const root = stack(OkLlm); await settle()
    expect((await root.agent.runTurn('default', new Session('d-r8'), 'chuỗi thuần')).content).toBe('ok')
    await root.fiber.dispose()
  })
  it('metadata/selectedSkill hợp lệ passthrough không phá turn', async () => {
    const root = stack(OkLlm); await settle()
    root.skills.register({ name: 'm', description: 'd', instructions: 'làm X', triggers: [], userInvocable: true })
    const r = await root.agent.runTurn('default', new Session('d-r9'), { message: 'hi', selectedSkill: 'm', metadata: { k: 1 } })
    expect(r.content).toBe('ok')
    await root.fiber.dispose()
  })
})

describe('D5 events/audit hiệu quả', () => {
  it('prompt_assembled hash 12-hex + toolsCount đúng; tool_audit ghi trước tool_result', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'echo', args: { t: 1 } } }
        return { content: 'ok' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'echo', description: 'e', handler: async () => 'v' })
    const s = new Session('d-v1')
    await root.agent.runTurn('default', s, 'hi')
    const evs = await root.storage.readEvents(s.id)
    const pa = evs.find((e) => e.type === 'prompt_assembled') as any
    expect(pa.promptHash).toMatch(/^[a-f0-9]{12}$/); expect(pa.toolsHash).toMatch(/^[a-f0-9]{12}$/)
    expect(evs.map((e) => e.type).indexOf('tool_audit')).toBeLessThan(evs.map((e) => e.type).indexOf('tool_result'))
    await root.fiber.dispose()
  })
  it('toolUi forward đúng (có ui -> object; không ui -> undefined) cả storage lẫn live', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: 'c', toolCall: { name: 'withui', args: {} } }
        return { content: 'ok' }
      }
    }
    const root = stack(L); await settle()
    root.tools.add({ name: 'withui', description: 'w', ui: { icon: '🔧', label: 'W' }, handler: async () => 1 })
    const steps: LoopStep[] = []
    root.on('agent/step', (e) => steps.push(e.step))
    const s = new Session('d-v2')
    await root.agent.runTurn('default', s, 'hi')
    expect((steps.find((x) => x.type === 'tool_result') as any).toolUi).toEqual({ icon: '🔧', label: 'W' })
    await root.fiber.dispose()
  })
  it('leaked label end-to-end: model trả label text -> tool thật được gọi', async () => {
    class L extends LlmService {
      async complete(msgs: LlmMessage[]): Promise<LlmCompletion> {
        if (!msgs.some((m) => m.role === 'tool')) return { content: '[tool_call:echo({"t":"leak"})]' }
        return { content: 'fixed' }
      }
    }
    const root = stack(L); await settle()
    let called: any = null
    root.tools.add({ name: 'echo', description: 'e', handler: async (a) => (called = a, 'v') })
    expect((await root.agent.runTurn('default', new Session('d-v3'), 'hi')).content).toBe('fixed')
    expect(called).toEqual({ t: 'leak' })
    await root.fiber.dispose()
  })
})
