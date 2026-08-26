import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { LlmService, type LlmMessage } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function boot(llm: new (ctx: Context) => LlmService) {
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
  await settle()
  return root
}

describe('AgentRunner run lifecycle', () => {
  it('serializes one session while allowing idempotent replay', async () => {
    const firstGate = deferred<void>()
    const secondGate = deferred<void>()
    let calls = 0
    class ControlledLlm extends LlmService {
      async complete() {
        calls++
        if (calls === 1) await firstGate.promise
        else await secondGate.promise
        return { content: `answer-${calls}` }
      }
    }
    const root = await boot(ControlledLlm)
    try {
      const session = new Session('serial')
      const first = root.agent.runTurn('default', session, { message: 'one', requestId: 'request-1' })
      const replay = root.agent.runTurn('default', session, { message: 'one', requestId: 'request-1' })
      const second = root.agent.runTurn('default', session, { message: 'two', requestId: 'request-2' })
      await settle()
      expect(calls).toBe(1)
      firstGate.resolve()
      expect((await first).content).toBe('answer-1')
      expect((await replay).content).toBe('answer-1')
      await settle()
      expect(calls).toBe(2)
      secondGate.resolve()
      await second
      expect((await root.agent.listRuns(session.id))).toHaveLength(2)
    } finally {
      await root.fiber.dispose()
    }
  })

  it('does not start the next turn until cancelled work has really stopped', async () => {
    const gate = deferred<void>()
    let calls = 0
    class SlowLlm extends LlmService {
      async complete(_messages: LlmMessage[]) {
        calls++
        if (calls === 1) await gate.promise
        return { content: 'done' }
      }
    }
    const root = await boot(SlowLlm)
    try {
      const session = new Session('cancel-safe')
      const first = root.agent.runTurn('default', session, 'slow')
      void first.catch(() => undefined)
      const second = root.agent.runTurn('default', session, 'next')
      await settle()
      const run = (await root.agent.listRuns(session.id))[0]!
      expect(await root.agent.cancelRun(run.id)).toBe(true)
      await settle()
      expect(calls).toBe(1)
      gate.resolve()
      await expect(first).rejects.toThrow('cancelled')
      expect((await root.agent.getRun(run.id))?.state).toBe('cancelled')
      expect((await second).content).toBe('done')
      expect(calls).toBe(2)
    } finally {
      await root.fiber.dispose()
    }
  })
})
