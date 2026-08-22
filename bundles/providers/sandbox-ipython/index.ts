import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import '../../../seams/sessions.ts'
import '../../../seams/llm.ts'
import '../../../seams/tools.ts'
import '../../../seams/skill.ts'
import type { LlmMessage } from '../../../seams/llm.ts'
import { SandboxEvent, SandboxRunResult, SandboxService, SandboxSessionOptions } from '../../../seams/sandbox.ts'

export namespace SandboxIpython {
  export interface LaunchOptions {
    sessionId: string
    workerPath: string
    cwd: string
    env: NodeJS.ProcessEnv
  }

  export interface Config {
    pythonBin?: string
    workerPath: string
    runtimeRoot: string
    agentConfig?: Record<string, unknown>
    /** Cho provider khác tái sử dụng JSONL/lifecycle bridge nhưng thay process boundary. */
    launch?: (options: LaunchOptions) => ChildProcessWithoutNullStreams
    closeProcess?: (sessionId: string, process: ChildProcessWithoutNullStreams) => Promise<void>
    loggerName?: string
  }
}

class EventQueue implements AsyncIterable<SandboxEvent> {
  private values: SandboxEvent[] = []
  private waiters: Array<(value: IteratorResult<SandboxEvent>) => void> = []
  private ended = false
  private error: Error | undefined

  push(value: SandboxEvent) {
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  end() {
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  fail(error: Error) {
    this.error = error
    this.end()
  }

  [Symbol.asyncIterator](): AsyncIterator<SandboxEvent> {
    return {
      next: async () => {
        if (this.values.length) return { value: this.values.shift()!, done: false }
        if (this.error) throw this.error
        if (this.ended) return { value: undefined, done: true }
        return new Promise<IteratorResult<SandboxEvent>>((resolve) => this.waiters.push(resolve))
      },
    }
  }
}

interface WorkerState {
  process: ChildProcessWithoutNullStreams
  cwd: string
  requests: Map<string, EventQueue>
  ready: Promise<void>
}

export class SandboxIpython extends SandboxService {
  private workers = new Map<string, WorkerState>()

  constructor(ctx: Context, public config: SandboxIpython.Config) {
    super(ctx)
  }

  [Service.init]() {
    const disposeSession = this.ctx.on('session/disposed', ({ id }) => {
      void this.closeSession(id)
    })
    return async () => {
      disposeSession()
      await Promise.all([...this.workers.keys()].map((id) => this.closeSession(id)))
    }
  }

  run(code: string, language: string): Promise<SandboxRunResult> {
    if (language !== 'python' && language !== 'python3') {
      return Promise.reject(new Error(`sandbox-ipython only supports python, received "${language}"`))
    }
    return new Promise((resolve, reject) => {
      execFile(this.config.pythonBin ?? 'python3', ['-c', code], { timeout: 300_000 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error)
        resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 })
      })
    })
  }

  async openSession(sessionId: string, options: SandboxSessionOptions): Promise<void> {
    const requestedCwd = options.cwd.startsWith('docker-volume://') ? options.cwd : path.resolve(options.cwd)
    const existing = this.workers.get(sessionId)
    if (existing) {
      if (existing.cwd !== requestedCwd) {
        throw new Error(`sandbox session "${sessionId}" is already bound to another workspace`)
      }
      await existing.ready
      return
    }

    const workerPath = path.resolve(this.config.workerPath)
    const cwd = requestedCwd
    const env = {
      ...process.env,
      RLM_RUNTIME_ROOT: path.resolve(this.config.runtimeRoot),
      RLM_AGENT_CONFIG_JSON: JSON.stringify(this.config.agentConfig ?? {}),
      RLM_WORKSPACE_ROOT: cwd,
    }
    const child = this.config.launch
      ? this.config.launch({ sessionId, workerPath, cwd, env })
      : spawn(this.config.pythonBin ?? 'python3', ['-u', workerPath], {
          cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
    const requests = new Map<string, EventQueue>()
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // A rejected startup must not become an unhandled rejection before
    // openSession reaches its await below.
    void ready.catch(() => undefined)
    const state: WorkerState = { process: child, cwd, requests, ready }
    this.workers.set(sessionId, state)

    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      let event: SandboxEvent
      try {
        event = JSON.parse(line) as SandboxEvent
      } catch {
        return this.ctx.logger(this.config.loggerName ?? 'sandbox-ipython').warn('ignored non-JSON worker output: %s', line)
      }
      if (event.type === '__ready__') {
        resolveReady()
        return
      }
      if (event.type === '__host_llm__') {
        void this.completeHostCall(state, event)
        return
      }
      if (event.type === '__host_tool__') {
        void this.completeToolCall(state, event)
        return
      }
      if (event.type === '__host_skill__') {
        void this.completeSkillRead(state, event)
        return
      }
      const requestId = String(event.requestId ?? '')
      const queue = requests.get(requestId)
      if (!queue) return
      if (event.type === '__done__') {
        queue.end()
        requests.delete(requestId)
      } else {
        const { requestId: _requestId, ...payload } = event
        queue.push(payload)
      }
    })
    child.stderr.on('data', (chunk) => this.ctx.logger(this.config.loggerName ?? 'sandbox-ipython').debug('%s', chunk.toString().trimEnd()))
    child.once('error', (error) => {
      rejectReady(error)
      this.failWorker(sessionId, error)
    })
    child.once('exit', (code, signal) => {
      const error = new Error(`python worker exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
      rejectReady(error)
      this.failWorker(sessionId, error)
    })

    await ready
  }

  request(
    sessionId: string,
    operation: string,
    payload: Record<string, unknown> = {},
  ): AsyncIterable<SandboxEvent> {
    const state = this.workers.get(sessionId)
    if (!state) throw new Error(`sandbox session "${sessionId}" is not open`)
    const requestId = randomUUID()
    const queue = new EventQueue()
    state.requests.set(requestId, queue)
    state.process.stdin.write(JSON.stringify({ requestId, operation, payload }) + '\n', (error) => {
      if (!error) return
      state.requests.delete(requestId)
      queue.fail(error)
    })
    return queue
  }

  async closeSession(sessionId: string): Promise<void> {
    const state = this.workers.get(sessionId)
    if (!state) return
    this.workers.delete(sessionId)
    for (const queue of state.requests.values()) queue.fail(new Error(`sandbox session "${sessionId}" closed`))
    state.requests.clear()
    if (state.process.exitCode !== null || state.process.killed) return
    if (this.config.closeProcess) {
      await this.config.closeProcess(sessionId, state.process)
      return
    }
    state.process.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        state.process.kill('SIGKILL')
        resolve()
      }, 2_000)
      state.process.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  private failWorker(sessionId: string, error: Error) {
    const state = this.workers.get(sessionId)
    if (!state) return
    this.workers.delete(sessionId)
    for (const queue of state.requests.values()) queue.fail(error)
    state.requests.clear()
  }

  private async completeHostCall(state: WorkerState, event: SandboxEvent) {
    const callId = String(event.callId ?? '')
    const requestId = String(event.requestId ?? '')
    try {
      const rawMessages = Array.isArray(event.messages) ? event.messages : []
      const messages: LlmMessage[] = rawMessages.map((message) => {
        const value = message as Record<string, unknown>
        const rawRole = String(value.role ?? 'user')
        const role: LlmMessage['role'] = rawRole === 'system' || rawRole === 'assistant' || rawRole === 'tool' ? rawRole : 'user'
        return { role, content: String(value.content ?? '') }
      })
      const completion = await this.ctx.llm.complete(messages, {
        model: typeof event.model === 'string' ? event.model : undefined,
        temperature: numberOrUndefined(event.temperature),
        maxTokens: numberOrUndefined(event.max_tokens),
        purpose: event.purpose === 'memory' || event.purpose === 'sub' ? event.purpose : 'root',
        extraBody: isRecord(event.extra_body) ? event.extra_body : undefined,
      })
      state.process.stdin.write(JSON.stringify({
        requestId,
        operation: '__host_llm_result__',
        payload: { callId, content: completion.content, usage: completion.usage, model: completion.model },
      }) + '\n')
    } catch (error) {
      state.process.stdin.write(JSON.stringify({
        requestId,
        operation: '__host_llm_result__',
        payload: { callId, error: error instanceof Error ? error.message : String(error) },
      }) + '\n')
    }
  }

  private async completeToolCall(state: WorkerState, event: SandboxEvent) {
    const callId = String(event.callId ?? '')
    const requestId = String(event.requestId ?? '')
    const name = String(event.name ?? '')
    const args = isRecord(event.args) ? event.args : {}
    const queue = state.requests.get(requestId)
    const tool = this.ctx.tools.get(name)
    queue?.push({ type: 'tool_call', name, args, toolUi: tool?.ui })
    try {
      const result = await this.ctx.tools.invoke(name, args, {
        sessionId: String(event.sessionId ?? ''),
        source: 'rlm',
      })
      queue?.push({ type: 'tool_result', name, result, toolUi: tool?.ui })
      state.process.stdin.write(JSON.stringify({
        requestId,
        operation: '__host_tool_result__',
        payload: { callId, result },
      }) + '\n')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      queue?.push({ type: 'tool_result', name, result: { error: message }, toolUi: tool?.ui })
      state.process.stdin.write(JSON.stringify({
        requestId,
        operation: '__host_tool_result__',
        payload: { callId, error: message },
      }) + '\n')
    }
  }

  private async completeSkillRead(state: WorkerState, event: SandboxEvent) {
    const callId = String(event.callId ?? '')
    const requestId = String(event.requestId ?? '')
    const skill = String(event.skill ?? '')
    const resourcePath = String(event.path ?? '')
    const queue = state.requests.get(requestId)
    try {
      const result = await this.ctx.skills.readResource(skill, resourcePath)
      queue?.push({ type: 'skill_resource', skill, path: resourcePath, encoding: result.encoding })
      state.process.stdin.write(JSON.stringify({
        requestId,
        operation: '__host_skill_result__',
        payload: { callId, result },
      }) + '\n')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.process.stdin.write(JSON.stringify({
        requestId,
        operation: '__host_skill_result__',
        payload: { callId, error: message },
      }) + '\n')
    }
  }

}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const inject = ['sessions', 'llm', 'tools', 'skills']

export const apply = async (ctx: Context, config: SandboxIpython.Config) => {
  await ctx.plugin(SandboxIpython, config)
}
