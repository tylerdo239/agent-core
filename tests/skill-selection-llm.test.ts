import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as skillSelectionLlm from '../bundles/providers/skill-selection-llm/index.ts'
import { LlmCompleteOptions, LlmMessage, LlmService } from '../seams/llm.ts'
import type { SkillDefinition } from '../seams/skill.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))
const candidates: SkillDefinition[] = [
  { name: 'cohort-analysis', description: 'Compare user retention over time.', instructions: 'cohort steps', triggers: [] },
  { name: 'forecasting', description: 'Forecast a numeric time series.', instructions: 'forecast steps', triggers: [] },
]

describe('LLM semantic skill selection provider', () => {
  it('returns only an exact catalog skill selected through tool calling', async () => {
    class RouterLlm extends LlmService {
      async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}) {
        expect(messages[0].content).toContain('cohort-analysis')
        expect(messages[1].content).toContain('signup month')
        expect(options.maxTokens).toBe(96)
        expect(options.tools?.[0].parameters).toMatchObject({
          properties: { name: { enum: ['cohort-analysis', 'forecasting'] } },
        })
        return {
          content: '', model: 'router-model',
          toolCall: { name: 'skill', args: { name: 'cohort-analysis' } },
          usage: { totalTokens: 12 },
        }
      }
    }
    const root = new Context()
    root.plugin(RouterLlm)
    root.plugin(skillSelectionLlm)
    await settle()

    const result = await root.skillSelection.select('Compare people by signup month and return behavior.', candidates)
    expect(result).toMatchObject({ skill: { name: 'cohort-analysis' }, model: 'router-model', usage: { totalTokens: 12 } })
    await root.fiber.dispose()
  })

  it('returns no skill when the routing model makes no tool call', async () => {
    class NoSkillLlm extends LlmService {
      async complete() { return { content: 'NO_SKILL' } }
    }
    const root = new Context()
    root.plugin(NoSkillLlm)
    root.plugin(skillSelectionLlm)
    await settle()
    expect((await root.skillSelection.select('hello', candidates)).skill).toBeUndefined()
    await root.fiber.dispose()
  })

  it('accepts the strict text fallback but rejects prose', async () => {
    class TextFallbackLlm extends LlmService {
      calls = 0
      async complete() {
        this.calls++
        return { content: this.calls === 1 ? 'SKILL:cohort-analysis' : 'I think cohort-analysis may help.' }
      }
    }
    const root = new Context()
    root.plugin(TextFallbackLlm)
    root.plugin(skillSelectionLlm)
    await settle()
    expect((await root.skillSelection.select('cohorts', candidates)).skill?.name).toBe('cohort-analysis')
    expect((await root.skillSelection.select('cohorts', candidates)).skill).toBeUndefined()
    await root.fiber.dispose()
  })

  it('normalizes Qwen enum-as-tool-name output only when it is in the catalog', async () => {
    class QwenShapeLlm extends LlmService {
      calls = 0
      async complete() {
        this.calls++
        return {
          content: '',
          toolCall: { name: this.calls === 1 ? 'cohort-analysis' : 'invented-skill', args: {} },
        }
      }
    }
    const root = new Context()
    root.plugin(QwenShapeLlm)
    root.plugin(skillSelectionLlm)
    await settle()
    expect((await root.skillSelection.select('cohorts', candidates)).skill?.name).toBe('cohort-analysis')
    expect((await root.skillSelection.select('cohorts', candidates)).skill).toBeUndefined()
    await root.fiber.dispose()
  })
})
