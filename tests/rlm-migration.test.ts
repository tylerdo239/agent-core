import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopRlm from '../bundles/loop-drivers/loop-rlm/index.ts'
import * as memoryRolling from '../bundles/providers/memory-rolling/index.ts'
import * as sandboxIpython from '../bundles/providers/sandbox-ipython/index.ts'
import { buildDockerWorkerArgs } from '../bundles/providers/sandbox-docker/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as skillFilesystem from '../bundles/providers/skill-filesystem/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptRlmDataAgent from '../bundles/prompts/prompt-rlm-data-agent/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as toolDatabaseQuery from '../bundles/tools/tool-database-query/index.ts'
import * as workspaceLocal from '../bundles/providers/workspace-local/index.ts'
import { LlmService } from '../seams/llm.ts'
import { SandboxRunResult, SandboxService, SandboxSessionOptions } from '../seams/sandbox.ts'
import { Session } from '../seams/loop.ts'
import { parseJsonObjectEnv } from '../src/env.ts'

const temporary: string[] = []
const temp = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-core-rlm-'))
  temporary.push(directory)
  return directory
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

describe('environment compatibility', () => {
  it('repairs JSON keys stripped by sourcing a dotenv file through the shell', () => {
    const parsed = parseJsonObjectEnv(
      '{cache:{no-cache:true},chat_template_kwargs:{enable_thinking:false},timeout:240}',
    )

    expect(parsed.repaired).toBe(true)
    expect(parsed.value).toEqual({
      cache: { 'no-cache': true },
      chat_template_kwargs: { enable_thinking: false },
      timeout: 240,
    })
  })
})

describe('section-based system prompt', () => {
  it('assembles by order, fails duplicate names, and hashes final content', async () => {
    const root = new Context()
    root.plugin(promptRegistry)
    await settle()
    root.prompts.section({ name: 'later', order: 20, text: 'later' })
    root.prompts.section({ name: 'earlier', order: 10, text: 'earlier' })

    const rendered = root.prompts.render({ driver: 'rlm' })
    expect(rendered.content).toBe('earlier\n\nlater')
    expect(rendered.version).toMatch(/^[a-f0-9]{12}$/)
    expect(() => root.prompts.section({ name: 'later', order: 30, text: 'duplicate' }))
      .toThrow('already registered')
    await root.fiber.dispose()
  })
})

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

class FakeLlm extends LlmService {
  async complete() {
    return {
      content: 'host-model-answer',
      model: 'fake-model',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    }
  }
}

class FakeRlmSandbox extends SandboxService {
  opened = new Map<string, string>()

  async run(): Promise<SandboxRunResult> {
    return { stdout: '', stderr: '', exitCode: 0 }
  }

  async openSession(sessionId: string, options: SandboxSessionOptions) {
    this.opened.set(sessionId, options.cwd)
  }

  async *request(_sessionId: string, operation: string, payload: Record<string, unknown>) {
    expect(operation).toBe('prepared_turn')
    expect(payload).toMatchObject({
      contractVersion: 2,
      sessionId: 'multi-turn',
      contextIndex: 0,
    })
    expect(payload.promptVersion).toMatch(/^[a-f0-9]{12}$/)
    expect(payload.prompt).toContain('The current user message is authoritative')
    expect(payload.prompt).toContain('Direct path')
    expect(payload.prompt).toContain('Never inspect a `context_N` merely to rediscover that request')
    expect(payload.prompt).toContain('Prose without a block makes no progress')
    expect(payload.prompt).not.toContain('Inspect the newest `context_N` first')
    expect(payload.prompt).not.toContain('Do not provide a final answer before this inspection')
    expect(payload.prompt).not.toContain('<session_memory>')
    expect(payload.prompt).not.toContain('<host_tools>')
    // Finding A1 (docs/agent-core-rate-limit-and-security-audit.md) fix:
    // query_database không còn nhận sessionId từ model — cập nhật cùng
    // guidance text đã sửa ở tool-database-query/index.ts.
    expect(payload.prompt).toContain('`query_database()`')
    expect(payload.context).toMatchObject({
      session_memory: expect.any(Object),
      available_tools: expect.any(Array),
    })
    yield { type: 'turn_started', run_id: 'run-1', context_index: 0 }
    yield { type: 'iteration_completed', iteration: 1, duration: 0.1 }
    yield { type: 'analysis', iteration: 1, content: 'inspect data' }
    yield { type: 'final_answer', content: 'kết quả RLM' }
    yield {
      type: '__result__',
      status: 'completed',
      answer: 'kết quả RLM',
      usage: { calls: 1 },
      memory: {
        state: 'completed',
        request: 'phân tích dữ liệu',
        outcome: 'kết quả RLM',
        trajectory: { iterations: [{ response: 'done' }] },
        context_index: 0,
        history_index: 0,
        next_context_index: 1,
        next_history_index: 1,
      },
    }
  }

  async closeSession() {}
}

describe('RLM backend migration', () => {
  it('loop-rlm dùng đúng seams và bridge event vào storage/live stream', async () => {
    const root = new Context()
    const workspace = temp()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(promptRlmDataAgent)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(toolDatabaseQuery)
    root.plugin(FakeLlm)
    root.plugin(memoryRolling, { basePath: path.join(workspace, 'memory') })
    root.plugin(workspaceLocal, { basePath: workspace })
    root.plugin(FakeRlmSandbox)
    root.plugin(loopRegistry)
    root.plugin(loopRlm)
    root.plugin(agentRunner)
    await settle()

    const live: string[] = []
    root.on('agent/step', ({ step }) => live.push(step.type))
    const session = new Session('multi-turn', 8, undefined, 'rlm')
    const result = await root.agent.runTurn('rlm', session, { message: 'phân tích dữ liệu' })

    expect(result).toMatchObject({ content: 'kết quả RLM', status: 'completed', steps: 1 })
    expect(live).toEqual(['turn_started', 'iteration_completed', 'analysis', 'final', 'memory_updated'])
    expect((await root.storage.readEvents(session.id)).map((event) => event.type)).toEqual([
      'user_message',
      'prompt_assembled',
      'turn_started',
      'iteration_completed',
      'analysis',
      'final_answer',
      'memory_updated',
    ])
    expect(session.history.at(-1)).toEqual({ role: 'assistant', content: 'kết quả RLM' })
    await root.fiber.dispose()
  })

  it('memory-rolling giữ summary/provenance theo session qua seam', async () => {
    const root = new Context()
    root.plugin(FakeLlm)
    root.plugin(memoryRolling, { basePath: temp() })
    await settle()

    await root.turnMemory.recordContext('s1', 0)
    const turn = await root.turnMemory.recordTurn('s1', {
      update: { summary: 'User cần cohort analysis', turnSummary: 'Đã nạp orders.csv' },
      state: 'waiting_user',
      request: 'phân tích cohort',
      contexts: ['context_0'],
      historyIndex: 0,
    })
    const snapshot = await root.turnMemory.snapshot('s1', { artifacts: ['generated/chart.png'] })

    expect(turn.history).toBe('history_0')
    expect(snapshot.summary).toBe('User cần cohort analysis')
    expect(snapshot.currentContext).toBe('context_0')
    expect(snapshot.resources.artifacts).toEqual(['generated/chart.png'])
    expect(await root.turnMemory.sourceContexts('s1', 1)).toEqual(['context_0', 'context_1'])
    await root.fiber.dispose()
  })

  it('skill-filesystem đăng ký entrypoint và resource locators', async () => {
    const rootDirectory = temp()
    const skill = path.join(rootDirectory, 'explore')
    mkdirSync(path.join(skill, 'references'), { recursive: true })
    writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: explore\ndescription: Explore data\nuser-invocable: true\n---\nDo exploration.')
    writeFileSync(path.join(skill, 'references', 'check.md'), 'Check missing values.')

    const root = new Context()
    root.plugin(skillRegistry)
    root.plugin(skillFilesystem, { root: rootDirectory })
    await settle()

    expect(root.skills.list({ userInvocableOnly: true, topLevelOnly: true }).map((item) => item.name)).toEqual(['explore'])
    expect(root.skills.get('explore')?.resources).toEqual([{ path: 'references/check.md', kind: 'reference' }])
    expect(await root.skills.readResource('explore', 'references/check.md')).toMatchObject({
      content: 'Check missing values.',
      encoding: 'utf8',
    })
    expect(root.skills.get('explore::references/check.md')).toBeUndefined()
    await root.fiber.dispose()
  })

  it('sandbox-ipython chỉ bridge model; memory thuộc loop/provider TypeScript', async () => {
    const directory = temp()
    const worker = path.join(directory, 'fake-worker.py')
    writeFileSync(worker, [
      'import json, sys',
      'print(json.dumps({"type":"__ready__"}), flush=True)',
      'for line in sys.stdin:',
      '    command = json.loads(line)',
      '    rid = command["requestId"]',
      '    print(json.dumps({"requestId":rid,"type":"__host_llm__","callId":"llm-1","messages":[{"role":"user","content":"hello"}],"purpose":"root"}), flush=True)',
      '    llm = json.loads(sys.stdin.readline())["payload"]',
      '    print(json.dumps({"requestId":rid,"type":"__host_tool__","callId":"tool-1","sessionId":"bridge","name":"echo_tool","args":{"value":"from-repl"}}), flush=True)',
      '    tool = json.loads(sys.stdin.readline())["payload"]',
      '    print(json.dumps({"requestId":rid,"type":"__host_skill__","callId":"skill-1","sessionId":"bridge","skill":"demo","path":"references/check.md"}), flush=True)',
      '    skill = json.loads(sys.stdin.readline())["payload"]',
      '    content = llm["content"] + ":" + tool["result"]["value"] + ":" + skill["result"]["content"]',
      '    print(json.dumps({"requestId":rid,"type":"final_answer","content":content}), flush=True)',
      '    print(json.dumps({"requestId":rid,"type":"__result__","status":"completed","answer":content}), flush=True)',
      '    print(json.dumps({"requestId":rid,"type":"__done__"}), flush=True)',
    ].join('\n'))

    const root = new Context()
    root.plugin(FakeLlm)
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(sessionRegistry)
    root.plugin(sandboxIpython, {
      pythonBin: 'python3',
      workerPath: worker,
      runtimeRoot: directory,
    })
    await settle()
    root.tools.add({
      name: 'echo_tool',
      description: 'Echo a value',
      async handler(args) { return { value: args.value } },
    })
    root.skills.register({
      name: 'demo',
      description: 'Demo',
      instructions: 'Demo instructions',
      triggers: [],
      resources: [{ path: 'references/check.md', kind: 'reference' }],
    }, async (resourcePath) => ({
      path: resourcePath,
      kind: 'reference',
      content: 'skill-content',
      encoding: 'utf8',
    }))

    await root.sandbox.openSession('bridge', { cwd: directory })
    const events = []
    for await (const event of root.sandbox.request('bridge', 'turn', { message: 'go' })) events.push(event)

    expect(events).toContainEqual({ type: 'tool_call', name: 'echo_tool', args: { value: 'from-repl' } })
    expect(events).toContainEqual({ type: 'tool_result', name: 'echo_tool', result: { value: 'from-repl' } })
    expect(events).toContainEqual({ type: 'skill_resource', skill: 'demo', path: 'references/check.md', encoding: 'utf8' })
    expect(events).toContainEqual({ type: 'final_answer', content: 'host-model-answer:from-repl:skill-content' })
    expect(events).toContainEqual({ type: '__result__', status: 'completed', answer: 'host-model-answer:from-repl:skill-content' })
    await root.sandbox.closeSession('bridge')
    await root.fiber.dispose()
  })

  it('sandbox-docker mount đúng source, worker và workspace; không truyền API key', () => {
    const args = buildDockerWorkerArgs({
      image: 'agent-core:latest',
      containerName: 'agent-core-rlm-s1-test',
      workspaceRoot: '/repo/workspaces/s1',
      sessionId: 's1',
      agentConfig: { api_key: 'host-llm-bridge', programmer_model: 'qwen' },
    })

    expect(args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(args).toContain('/repo/workspaces/s1:/workspaces/s1')
    expect(args).toContain('RLM_RUNTIME_ROOT=/app/bundles/loop-drivers/loop-rlm/python')
    expect(args.at(-1)).toBe('/app/bundles/loop-drivers/loop-rlm/python/worker.py')
    expect(args).toContain('--network')
    expect(args.at(-4)).toBe('agent-core:latest')
    expect(args.join(' ')).not.toContain('OPENAI_API_KEY')
  })

  it('sandbox-docker dùng named volume thì không bind workspace host', () => {
    const args = buildDockerWorkerArgs({
      image: 'agent-core:latest',
      containerName: 'agent-core-rlm-s2-test',
      workspaceRoot: 'docker-volume://agent-core-rlm-workspace-s2',
      sessionId: 's2',
      agentConfig: {},
    })

    expect(args).toContain('agent-core-rlm-workspace-s2:/workspaces/s2')
    expect(args).not.toContain('--user')
    expect(args.join(' ')).not.toContain('/repo/workspaces')
  })
})
