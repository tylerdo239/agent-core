import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import { LlmCompleteOptions, LlmMessage, LlmService } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('default-loop context compaction', () => {
  it('compacts before the root model call, commits the short history, and emits observable events', async () => {
    const rootCalls: LlmMessage[][] = []
    class CompactingLlm extends LlmService {
      async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}) {
        if (options.purpose === 'memory') {
          return { content: JSON.stringify({ prior_summary: 'Earlier discussion compacted.', progress_summary: '' }) }
        }
        rootCalls.push(messages)
        return { content: 'continued successfully' }
      }
    }

    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(promptDefaultAgent)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(CompactingLlm)
    root.plugin(contextCompactorLlm, { contextLimitTokens: 2_500, thresholdPct: 0.8 })
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    await settle()

    const session = new Session('compact-default', 8, undefined, 'default', 100)
    for (let index = 0; index < 10; index++) {
      session.history.push({ role: 'user', content: `old request ${index} ${'x'.repeat(700)}` })
      session.history.push({ role: 'assistant', content: `old response ${index} ${'y'.repeat(700)}` })
    }
    const live: string[] = []
    root.on('agent/step', ({ step }) => live.push(step.type))

    const result = await root.agent.runTurn('default', session, 'Continue the current task.')
    expect(result.content).toBe('continued successfully')
    expect(rootCalls).toHaveLength(1)
    expect(rootCalls[0].some((message) => message.content.includes('Earlier discussion compacted.'))).toBe(true)
    expect(rootCalls[0].at(-1)).toEqual({ role: 'user', content: 'Continue the current task.' })
    expect(session.history.some((message) => message.content.includes('old request 0'))).toBe(false)
    expect(session.history.some((message) => message.content.includes('[conversation_summary]'))).toBe(true)

    const events = await root.storage.readEvents(session.id)
    expect(events.map((event) => event.type)).toEqual([
      'user_message', 'context_usage', 'context_compacted', 'context_usage',
      'prompt_assembled', 'model_message',
    ])
    expect(live).toEqual(['context_usage', 'context_usage', 'model_message', 'final'])
    await root.fiber.dispose()
  })
})
