import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { LlmCompleteOptions, LlmMessage, LlmService } from '../seams/llm.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

describe('context-compactor-llm', () => {
  it('inspects the exact payload and semantically compacts prior/progress around the current request', async () => {
    class SummaryLlm extends LlmService {
      async complete(_messages: LlmMessage[], options: LlmCompleteOptions = {}) {
        expect(options).toMatchObject({ purpose: 'memory', temperature: 0 })
        return { content: JSON.stringify({
          prior_summary: 'User previously selected dataset A.',
          progress_summary: 'Tool lookup returned 42; final explanation is pending.',
        }) }
      }
    }
    const root = new Context()
    root.plugin(SummaryLlm)
    root.plugin(contextCompactorLlm, { contextLimitTokens: 300, thresholdPct: 0.8 })
    await settle()

    const history: LlmMessage[] = [
      { role: 'system', content: 'application instruction' },
      { role: 'user', content: `old request ${'x'.repeat(900)}` },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'What is the final value?' },
      { role: 'assistant', content: '[tool_call:lookup({})]' },
      { role: 'tool', content: '[lookup] 42' },
    ]
    expect(root.contextCompactor.inspect(history).shouldCompact).toBe(true)
    const result = await root.contextCompactor.compact(history)

    expect(result.quality).toBe('semantic')
    expect(result.messages.map((message) => message.role)).toEqual(['system', 'assistant', 'user', 'assistant'])
    expect(result.messages[1].content).toContain('dataset A')
    expect(result.messages[2].content).toBe('What is the final value?')
    expect(result.messages[3].content).toContain('returned 42')
    await root.fiber.dispose()
  })

  it('uses a bounded deterministic fallback when the summary model fails', async () => {
    class BrokenLlm extends LlmService {
      async complete(): Promise<never> { throw new Error('summary unavailable') }
    }
    const root = new Context()
    root.plugin(BrokenLlm)
    root.plugin(contextCompactorLlm)
    await settle()

    const result = await root.contextCompactor.compact([
      { role: 'user', content: `old ${'x'.repeat(8_000)}` },
      { role: 'assistant', content: 'old result' },
      { role: 'user', content: 'current request' },
    ])
    expect(result).toMatchObject({ quality: 'fallback', error: 'summary unavailable' })
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: 'current request' })
    expect(result.summary.length).toBeLessThanOrEqual(5_020)
    await root.fiber.dispose()
  })
})
