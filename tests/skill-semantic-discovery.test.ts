import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as toolSkill from '../bundles/tools/tool-skill/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../seams/llm.ts'
import { Session } from '../seams/loop.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

function registerSemanticSkill(ctx: Context) {
  ctx.skills.register({
    name: 'cohort-analysis',
    description: 'Analyze retention by signup cohort and compare behavior over time.',
    instructions: 'Build a retention matrix before drawing conclusions.',
    triggers: [],
    userInvocable: true,
    resources: [{ path: 'references/retention.md', kind: 'reference' }],
  }, async (resourcePath) => ({
    path: resourcePath,
    kind: 'reference',
    content: 'Retention is active users divided by the original cohort size.',
    encoding: 'utf8',
  }))
}

describe('semantic skill discovery shared by the default loop', () => {
  it('model discovers a zero-trigger skill, loads it, then reads a declared resource', async () => {
    const captured: LlmMessage[][] = []
    class SemanticLlm extends LlmService {
      async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
        captured.push(messages)
        expect(options.tools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(['skill', 'read_skill_resource']))
        const toolResults = messages.filter((message) => message.role === 'tool')
        if (toolResults.length === 0) {
          expect(messages[0]?.content).toContain('cohort-analysis')
          return { content: 'I found a relevant skill.', toolCall: { name: 'skill', args: { name: 'cohort-analysis' } } }
        }
        if (toolResults.length === 1) {
          expect(toolResults[0].content).toContain('Build a retention matrix')
          return {
            content: 'I need its metric definition.',
            toolCall: { name: 'read_skill_resource', args: { name: 'cohort-analysis', path: 'references/retention.md' } },
          }
        }
        expect(toolResults[1].content).toContain('original cohort size')
        return { content: 'Cohort workflow and definition loaded.' }
      }
    }

    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(promptDefaultAgent)
    root.plugin(contextCompactorLlm)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(SemanticLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    root.plugin(toolSkill)
    await settle()
    registerSemanticSkill(root)

    const result = await root.agent.runTurn('default', new Session('semantic-skill'), {
      message: 'Compare whether users who joined in different months keep returning.',
    })

    expect(result).toMatchObject({ content: 'Cohort workflow and definition loaded.', steps: 2 })
    // Ephemeral catalog guidance must remain present after every tool result.
    expect(captured).toHaveLength(3)
    for (const messages of captured) expect(messages[0]?.content).toContain('<skill_catalog>')

    const events = await root.storage.readEvents('semantic-skill')
    expect(events.filter((event) => event.type === 'skill_loaded')).toMatchObject([
      { skill: 'cohort-analysis', activation: 'agent' },
    ])
    expect(events.filter((event) => event.type === 'skill_resource')).toMatchObject([
      { skill: 'cohort-analysis', path: 'references/retention.md' },
    ])
    await root.fiber.dispose()
  })

  it('explicit selection wins and is preloaded before the first model call', async () => {
    class SelectedLlm extends LlmService {
      async complete(messages: LlmMessage[]): Promise<LlmCompletion> {
        expect(messages[0]?.content).toContain('Build a retention matrix before drawing conclusions.')
        expect(messages[0]?.content).toContain('explicitly selected "cohort-analysis"')
        return { content: 'Selected skill is active.' }
      }
    }

    const root = new Context()
    root.plugin(toolRegistry)
    root.plugin(skillRegistry)
    root.plugin(promptRegistry)
    root.plugin(promptDefaultAgent)
    root.plugin(contextCompactorLlm)
    root.plugin(stateSqlite, { path: ':memory:' })
    root.plugin(SelectedLlm)
    root.plugin(loopRegistry)
    root.plugin(loopDefault)
    root.plugin(agentRunner)
    root.plugin(toolSkill)
    await settle()
    registerSemanticSkill(root)

    await root.agent.runTurn('default', new Session('selected-skill'), {
      message: 'Help me inspect retention.', selectedSkill: 'cohort-analysis',
    })
    const loaded = (await root.storage.readEvents('selected-skill')).find((event) => event.type === 'skill_loaded')
    expect(loaded).toMatchObject({ skill: 'cohort-analysis', activation: 'selected' })
    await root.fiber.dispose()
  })
})
