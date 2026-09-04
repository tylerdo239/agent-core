// Luật: chuỗi HIỂN THỊ ra UI và chuỗi THẬT SỰ dùng để tra cứu/thực thi phải
// là MỘT. Trước đây tool-skill và sandbox-ipython.completeSkillRead vá chuỗi
// lúc dựng event nhưng tra cứu bằng raw — nghĩa là arg bẩn (model nhúng nhãn
// nội bộ `[tool_call:...]` vào name/path) làm lời gọi fail, trong khi phần
// sanitize ở dưới không bao giờ chạy tới (readResource khớp path chính xác
// tuyệt đối nên throw trước). Các test dưới đây chạy ĐỎ nếu quay lại lookup
// bằng raw: chúng khẳng định lời gọi bẩn vẫn THỰC THI THẬT và event ghi đúng
// chuỗi đã dùng để thực thi.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as sandboxIpython from '../bundles/providers/sandbox-ipython/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as toolSkill from '../bundles/tools/tool-skill/index.ts'
import { LlmService } from '../seams/llm.ts'
import type { SandboxEvent } from '../seams/sandbox.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

// Đúng dạng rác thấy trong production: arg hợp lệ + newline + nhãn nội bộ.
const DIRTY_SUFFIX = '\n[tool_call:web_search({"query":"tình hình ngành"})]'

class UnusedLlm extends LlmService {
  async complete() { return { content: '' } }
}

function registerSkill(ctx: Context) {
  ctx.skills.register({
    name: 'business-case-builder',
    description: 'Build a full business case.',
    instructions: 'Follow the KPI framework.',
    triggers: ['business case'],
    userInvocable: true,
    resources: [{ path: 'references/kpi-framework.md', kind: 'reference' }],
  }, async (resourcePath) => ({
    path: resourcePath, kind: 'reference', encoding: 'utf8', content: 'KPI framework content.',
  }))
}

describe('tool-skill — vá arg TRƯỚC khi đọc resource', () => {
  let root: Context

  beforeEach(async () => {
    root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(toolSkill)
    await settle()
    registerSkill(root)
  })
  afterEach(async () => { await root.fiber.dispose() })

  it('path nhúng nhãn nội bộ -> resource VẪN ĐỌC ĐƯỢC (không còn fail vì lookup bằng raw)', async () => {
    const tool = root.tools.get('read_skill_resource')!
    const resource = (await tool.handler(
      { name: 'business-case-builder', path: `references/kpi-framework.md${DIRTY_SUFFIX}` },
      { sessionId: 'session-dirty-path', source: 'default-loop' },
    )) as { path: string; content: string }

    expect(resource.content).toBe('KPI framework content.')
    expect(resource.path).toBe('references/kpi-framework.md')
  })

  it('event ghi đúng CHUỖI ĐÃ DÙNG để đọc — hiển thị và thực thi không lệch nhau', async () => {
    const tool = root.tools.get('read_skill_resource')!
    await tool.handler(
      { name: `business-case-builder${DIRTY_SUFFIX}`, path: `references/kpi-framework.md${DIRTY_SUFFIX}` },
      { sessionId: 'session-dirty-both', source: 'default-loop' },
    )

    const events = (await root.storage.readEvents('session-dirty-both')) as Array<Record<string, unknown>>
    expect(events).toContainEqual(expect.objectContaining({
      type: 'skill_resource', skill: 'business-case-builder', path: 'references/kpi-framework.md',
    }))
    for (const event of events) expect(JSON.stringify(event)).not.toContain('[tool_call:')
  })

  it('skill name sạch vẫn đi đường cũ nguyên vẹn (sanitize là no-op)', async () => {
    const tool = root.tools.get('read_skill_resource')!
    const resource = (await tool.handler(
      { name: 'business-case-builder', path: 'references/kpi-framework.md' },
      { sessionId: 'session-clean', source: 'default-loop' },
    )) as { content: string }
    expect(resource.content).toBe('KPI framework content.')
  })
})

describe('sandbox-ipython — vá arg từ worker TRƯỚC khi invoke/readResource', () => {
  let directory: string
  let root: Context

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'agent-core-sanitize-'))
    // Worker giả: nhận chuỗi bẩn qua payload rồi gửi ngược lên host đúng như
    // worker.py thật (`__host_tool__` / `__host_skill__`), để test đi qua
    // completeToolCall/completeSkillRead thật thay vì gọi private method.
    writeFileSync(path.join(directory, 'worker.py'), [
      'import json, sys',
      'print(json.dumps({"type": "__ready__"}), flush=True)',
      'for line in sys.stdin:',
      '    msg = json.loads(line)',
      '    op = msg.get("operation")',
      '    rid = msg.get("requestId")',
      '    payload = msg.get("payload") or {}',
      '    if op == "call_tool":',
      '        print(json.dumps({"type": "__host_tool__", "requestId": rid, "callId": "c1",',
      '                          "name": payload.get("name"), "args": {"value": "hi"}}), flush=True)',
      '    elif op == "read_skill":',
      '        print(json.dumps({"type": "__host_skill__", "requestId": rid, "callId": "c1",',
      '                          "skill": payload.get("skill"), "path": payload.get("path")}), flush=True)',
      '    elif op in ("__host_tool_result__", "__host_skill_result__"):',
      '        print(json.dumps({"type": "worker_received", "requestId": rid, "payload": payload}), flush=True)',
      '        print(json.dumps({"type": "__done__", "requestId": rid}), flush=True)',
    ].join('\n'))

    root = new Context()
    root.plugin(sessionRegistry)
    root.plugin(skillRegistry)
    root.plugin(toolRegistry)
    root.plugin(UnusedLlm)
    root.plugin(sandboxIpython, { workerPath: path.join(directory, 'worker.py'), runtimeRoot: directory })
    await settle()
    registerSkill(root)
    root.tools.add({
      name: 'echo_tool',
      description: 'Echo lại value để chứng minh tool đã chạy thật.',
      handler: async (args: Record<string, unknown>) => ({ echoed: args.value }),
    })
    await root.sandbox.openSession('s', { cwd: directory })
  })

  afterEach(async () => {
    await root.sandbox.closeSession('s').catch(() => undefined)
    await root.fiber.dispose()
    rmSync(directory, { recursive: true, force: true })
  })

  async function collect(operation: string, payload: Record<string, unknown>) {
    const events: SandboxEvent[] = []
    for await (const event of root.sandbox.request('s', operation, payload)) events.push(event)
    return events
  }

  it('tên tool từ worker dính nhãn nội bộ -> tool THẬT SỰ CHẠY, event mang tên đã vá', async () => {
    const events = await collect('call_tool', { name: `echo_tool${DIRTY_SUFFIX}` })

    const call = events.find((e) => e.type === 'tool_call')
    const result = events.find((e) => e.type === 'tool_result')
    expect(call?.name).toBe('echo_tool')
    // Đây là chỗ phân biệt: lookup bằng raw thì result là { error: ... }.
    expect(result?.result).toEqual({ echoed: 'hi' })
    expect(result?.name).toBe('echo_tool')
    // Worker nhận được kết quả thật, không phải error.
    const received = events.find((e) => e.type === 'worker_received') as { payload?: Record<string, unknown> } | undefined
    expect(received?.payload?.result).toEqual({ echoed: 'hi' })
    expect(received?.payload?.error).toBeUndefined()
  }, 15_000)

  it('path skill từ worker dính nhãn nội bộ -> resource ĐỌC ĐƯỢC, event mang path đã vá', async () => {
    const events = await collect('read_skill', {
      skill: 'business-case-builder',
      path: `references/kpi-framework.md${DIRTY_SUFFIX}`,
    })

    const step = events.find((e) => e.type === 'skill_resource')
    expect(step?.path).toBe('references/kpi-framework.md')
    expect(step?.skill).toBe('business-case-builder')
    const received = events.find((e) => e.type === 'worker_received') as { payload?: Record<string, unknown> } | undefined
    expect((received?.payload?.result as { content?: string } | undefined)?.content).toBe('KPI framework content.')
    expect(received?.payload?.error).toBeUndefined()
  }, 15_000)
})
