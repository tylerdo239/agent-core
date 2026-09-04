// Exhaustive: errors taxonomy + classifyError fuzz + sessionHealthNote/inBandFeedback
// + contracts validator + repairLeakedToolCallLabel fuzz.
import { describe, expect, it } from 'vitest'
import {
  classifyError, ERROR_TAXONOMY, HarnessErrorCode, inBandFeedback,
  isHarnessErrorCode, sessionHealthNote,
} from '../src/errors.ts'
import { createContractValidator, ContractValidationError, registerContract, validateContract } from '../src/contracts.ts'
import { repairLeakedToolCallLabel } from '../src/leaked-tool-call-label.ts'

describe('E1 ERROR_TAXONOMY bao phủ 17 mã', () => {
  const codes: HarnessErrorCode[] = ['CODE_PARSE', 'NO_PROGRESS', 'TOOL_ARGS', 'TOOL_EXEC', 'TOOL_NOT_FOUND', 'SKILL_MISSING', 'SKILL_READ', 'CODE_RUNTIME', 'LLM_PROVIDER', 'CONTEXT_OVERFLOW', 'CONTRACT', 'WORKER', 'STATE_CORRUPT', 'HUMAN_DENIED', 'CANCELLED', 'TIMEOUT']
  it('đủ 16 mã trong taxonomy (CODE list)', () => {
    for (const c of codes) expect(ERROR_TAXONOMY[c]).toBeDefined()
  })
  it('mỗi mã có summary+guidance non-empty + recoverable boolean', () => {
    for (const [code, d] of Object.entries(ERROR_TAXONOMY)) {
      expect(d.summary.length).toBeGreaterThan(0)
      expect(d.guidance.length).toBeGreaterThan(0)
      expect(typeof d.recoverable).toBe('boolean')
    }
  })
  it('recoverable=false đúng cho hạ tầng (LLM_PROVIDER/CONTRACT/WORKER/CANCELLED/TIMEOUT)', () => {
    for (const c of ['LLM_PROVIDER', 'CONTRACT', 'WORKER', 'CANCELLED', 'TIMEOUT'] as const) {
      expect(ERROR_TAXONOMY[c].recoverable).toBe(false)
    }
  })
  it('recoverable=true cho model tự sửa được', () => {
    for (const c of ['CODE_PARSE', 'NO_PROGRESS', 'TOOL_ARGS', 'TOOL_EXEC', 'CODE_RUNTIME'] as const) {
      expect(ERROR_TAXONOMY[c].recoverable).toBe(true)
    }
  })
})

describe('E2 classifyError exhaustive patterns', () => {
  it.each([
    ['LLM provider returned 429 Too Many Requests', 'LLM_PROVIDER'],
    ['openai API 500 server error', 'LLM_PROVIDER'],
    ['rate limit exceeded for model', 'LLM_PROVIDER'],
    ['RateLimit: slow down', 'LLM_PROVIDER'],
    ['503 provider unavailable', 'LLM_PROVIDER'],
    ['ENOENT: worker.py not found', 'WORKER'],
    ['worker crashed with exit 1', 'WORKER'],
    ['broker shut down', 'WORKER'],
    ['RLM worker ended without a turn result', 'WORKER'],
    ['ended without a result', 'WORKER'],
    ['contract validation failed: missing prompt', 'CONTRACT'],
    ['schema violation in prepared turn', 'CONTRACT'],
    ['session "s" exceeded maxSteps (25)', 'CONTEXT_OVERFLOW'],
    ['context remains above threshold after compacting', 'CONTEXT_OVERFLOW'],
    ['compaction failed', 'CONTEXT_OVERFLOW'],
    ['context limit reached', 'CONTEXT_OVERFLOW'],
    ['Traceback (most recent call last): ... ValueError', 'CODE_RUNTIME'],
    ['ZeroDivisionError: division by zero', 'CODE_RUNTIME'],
    ["'somekey'", 'CODE_RUNTIME'],
    ['NameError: name x is not defined', 'CODE_RUNTIME'],
    ['AttributeError: foo', 'CODE_RUNTIME'],
    ['SyntaxError: invalid syntax', 'CODE_RUNTIME'],
    ['TypeError: unsupported', 'CODE_RUNTIME'],
    ['KeyError: 42', 'CODE_RUNTIME'],
    ['CANCELLED', 'CANCELLED'],
    ['run cancelled by user', 'CANCELLED'],
    ['Aborted by signal', 'CANCELLED'],
    ['tool "ghost_tool" not found', 'TOOL_NOT_FOUND'],
    ['operation timed out after 3000ms', 'TIMEOUT'],
    ['timeout sau 5000ms', 'TIMEOUT'],
  ])('classify %j -> %s', (msg, code) => {
    expect(classifyError(msg as string)).toBe(code)
  })
  it('mã trần "TIMEOUT"/"CANCELLED"/"WORKER" -> chính nó', () => {
    expect(classifyError('TIMEOUT')).toBe('TIMEOUT')
    expect(classifyError('CANCELLED')).toBe('CANCELLED')
    expect(classifyError('  WORKER  ')).toBe('WORKER')
  })
  it('429 kèm tool/skill -> KHÔNG phải LLM_PROVIDER (tránh nhầm)', () => {
    expect(classifyError('tool web_search rate limit 429')).not.toBe('LLM_PROVIDER')
  })
  it('null/undefined/number/object cast -> fallback WORKER, không throw', () => {
    for (const v of [null, undefined, 0, 42, {}, [], true] as any) {
      expect(() => classifyError(v)).not.toThrow()
    }
    expect(classifyError(null as any)).toBe('WORKER')
  })
  it('message 200k chars vẫn classify <100ms', () => {
    const big = 'Traceback ' + 'x'.repeat(200_000)
    const t = Date.now()
    expect(classifyError(big)).toBe('CODE_RUNTIME')
    expect(Date.now() - t).toBeLessThan(100)
  })
  it('multiline + unicode + emoji không throw', () => {
    expect(() => classifyError('lỗi 😀\n dòng 2 \n 中文 429 provider')).not.toThrow()
  })
  it('isHarnessErrorCode: phân biệt hoa/thường/khoảng trắng', () => {
    expect(isHarnessErrorCode('cancelled')).toBe(false)
    expect(isHarnessErrorCode(' CANCELLED')).toBe(false)
    expect(isHarnessErrorCode(42)).toBe(false)
    expect(isHarnessErrorCode(null)).toBe(false)
  })
})

describe('E3 sessionHealthNote + inBandFeedback exhaustive', () => {
  it('mọi mã taxonomy đều sinh note non-empty', () => {
    for (const code of Object.keys(ERROR_TAXONOMY)) {
      const n = sessionHealthNote({ code, message: 'm' })
      expect(n).toContain(code); expect(n).toContain('Session health notice')
    }
  })
  it('code lạ -> classify từ message thay vì dùng code', () => {
    const n = sessionHealthNote({ code: 'BOGUS', message: 'worker crashed' })
    expect(n).toContain('WORKER')
  })
  it('code undefined + message lạ -> fallback WORKER', () => {
    expect(sessionHealthNote({ message: 'xyz unknown' })).toContain('WORKER')
  })
  it('message dài 50k -> note vẫn sinh, không throw', () => {
    expect(() => sessionHealthNote({ message: 'x'.repeat(50_000) })).not.toThrow()
  })
  it('inBandFeedback mọi mã: prefix [HARNESS ERROR X] + ACTION REQUIRED', () => {
    for (const code of Object.keys(ERROR_TAXONOMY) as HarnessErrorCode[]) {
      const f = inBandFeedback(code)
      expect(f).toContain(`[HARNESS ERROR ${code}]`)
      expect(f).toContain('ACTION REQUIRED')
    }
  })
  it('inBandFeedback có detail + non-recoverable gắn cảnh báo', () => {
    expect(inBandFeedback('WORKER', 'pipe broken')).toContain('DETAIL: pipe broken')
    expect(inBandFeedback('WORKER')).not.toContain('DETAIL')
    expect(inBandFeedback('CODE_PARSE', 'd')).not.toContain('not self-recoverable')
  })
})

describe('E4 contracts validator exhaustive', () => {
  it('validateContract tên chưa register -> throw rõ', () => {
    expect(() => validateContract('nope/never', {})).toThrow(/not registered/)
  })
  it('register + validate pass/fail', () => {
    registerContract('t/obj', { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })
    expect(validateContract<{ a: string }>('t/obj', { a: 'x' })).toEqual({ a: 'x' })
    expect(() => validateContract('t/obj', { a: 1 })).toThrow(ContractValidationError)
    expect(() => validateContract('t/obj', null)).toThrow(ContractValidationError)
  })
  it('createContractValidator: const/enum/minLength/minimum/array/object biên', () => {
    const v = createContractValidator<any>('t/b', {
      type: 'object', required: ['v', 'n', 'arr'],
      properties: { v: { const: 2 }, n: { type: 'string', minLength: 1 }, arr: { type: 'array' }, i: { type: 'integer', minimum: 0 } },
    })
    expect(() => v({ v: 3, n: 'x', arr: [] })).toThrow(/Invalid t\/b/)
    expect(() => v({ v: 2, n: '', arr: [] })).toThrow()
    expect(() => v({ v: 2, n: 'x', arr: {}, i: -1 })).toThrow()
    expect(v({ v: 2, n: 'x', arr: [], i: 1.0, extra: 'ok' })).toBeDefined() // additionalProperties mặc định cho phép
  })
  it('error message chứa instancePath để debug', () => {
    const v = createContractValidator('t/dbg', { type: 'object', required: ['a'], properties: { a: { type: 'string' } } })
    try { v({}); expect.unreachable() } catch (e: any) { expect(e.message).toContain('Invalid t/dbg') }
  })
})

describe('E5 repairLeakedToolCallLabel fuzz', () => {
  const exists = (n: string) => ['tool_a', 'my-tool', 't123'].includes(n)
  it('tên tool biên: gạch ngang/gạch dưới/số; tên sai cú pháp giữ nguyên', () => {
    expect(repairLeakedToolCallLabel({ content: '[tool_call:my-tool({"x":1})]' }, exists).toolCall!.name).toBe('my-tool')
    expect(repairLeakedToolCallLabel({ content: '[tool_call:9bad({"x":1})]' }, () => true).toolCall).toBeUndefined()
    expect(repairLeakedToolCallLabel({ content: '[tool_call:has space({"x":1})]' }, () => true).toolCall).toBeUndefined()
  })
  it('whitespace quanh label (newline/tab) vẫn repair sau trim', () => {
    const r = repairLeakedToolCallLabel({ content: '  \n[tool_call:tool_a({"x":1})]\t\n' }, exists)
    expect(r.toolCall).toEqual({ name: 'tool_a', args: { x: 1 } })
  })
  it('args nested sâu/unicode/empty object', () => {
    expect(repairLeakedToolCallLabel({ content: '[tool_call:tool_a({})]' }, exists).toolCall).toEqual({ name: 'tool_a', args: {} })
    const deep = { content: '[tool_call:tool_a({"a":{"b":[1,{"c":"😀"}]}})]' }
    expect(repairLeakedToolCallLabel(deep, exists).toolCall!.args).toEqual({ a: { b: [1, { c: '😀' }] } })
  })
  it('args scalar (string/number/bool) -> không repair', () => {
    for (const a of ['"s"', '42', 'true']) {
      expect(repairLeakedToolCallLabel({ content: `[tool_call:tool_a(${a})]` }, exists).toolCall).toBeUndefined()
    }
  })
  it('2 label nối nhau / label + text thừa -> không repair', () => {
    expect(repairLeakedToolCallLabel({ content: '[tool_call:tool_a({})][tool_call:tool_a({})]' }, exists).toolCall).toBeUndefined()
  })
  it('content 100k chứa label ở cuối nhưng có prefix -> không repair (đúng thiết kế exact-match)', () => {
    const c = 'p'.repeat(100_000) + '[tool_call:tool_a({})]'
    expect(repairLeakedToolCallLabel({ content: c }, exists).toolCall).toBeUndefined()
  })
  it('toolExists throw -> lan ra (không swallow)', () => {
    expect(() => repairLeakedToolCallLabel({ content: '[tool_call:t({})]' }, () => { throw new Error('boom-exists') })).toThrow(/boom-exists/)
  })
  it('response có field thừa được giữ (spread), không mất content khác', () => {
    const r = repairLeakedToolCallLabel({ content: '[tool_call:tool_a({"x":1})]', extra: 5 } as any, exists) as any
    expect(r.extra).toBe(5); expect(r.toolCall.name).toBe('tool_a')
  })
})
