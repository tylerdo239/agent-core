import { Context } from '@deepseek-ai/cordis'
import '../../../seams/llm.ts'
import { SkillSelectionService } from '../../../seams/skill-selection.ts'

export class LlmSkillSelection extends SkillSelectionService {
  async select(message: string, candidates: Parameters<SkillSelectionService['select']>[1], signal?: AbortSignal) {
    if (!candidates.length) return {}
    const catalog = candidates.map(({ name, description }) => ({ name, description }))
    const response = await this.ctx.llm.complete([
      {
        role: 'system',
        content: [
          'You are a skill-routing gate, not the task-solving agent.',
          'If exactly one catalog description clearly helps fulfill the request, call the `skill` tool with its exact name.',
          'If tool calling is unavailable, output exactly SKILL:<exact-name>. If none clearly applies, output exactly NO_SKILL.',
          'Never answer the user request. Never choose from name similarity alone.',
          `<skill_catalog>${JSON.stringify(catalog)}</skill_catalog>`,
        ].join('\n'),
      },
      { role: 'user', content: message },
    ], {
      tools: [{
        name: 'skill',
        description: 'Select one clearly relevant skill from the supplied catalog.',
        parameters: {
          type: 'object', required: ['name'], additionalProperties: false,
          properties: { name: { type: 'string', enum: candidates.map((skill) => skill.name) } },
        },
      }],
      temperature: 0,
      maxTokens: 96,
      purpose: 'root',
      signal,
    })
    const toolSelected = response.toolCall?.name === 'skill' && typeof response.toolCall.args.name === 'string'
      ? response.toolCall.args.name
      : undefined
    // Some OpenAI-compatible Qwen templates emit the chosen enum value as
    // the tool name itself (`cohort-analysis`, args={}) instead of wrapping it
    // as `skill({name: ...})`. Accept only an exact catalog name.
    const directToolSelected = response.toolCall && candidates.some((candidate) => candidate.name === response.toolCall?.name)
      ? response.toolCall.name
      : undefined
    const textSelected = /^\s*SKILL\s*:\s*([a-z0-9][a-z0-9_-]*)\s*$/i.exec(response.content)?.[1]
    const selectedName = toolSelected ?? directToolSelected ?? textSelected
    return {
      skill: selectedName ? candidates.find((candidate) => candidate.name === selectedName) : undefined,
      model: response.model,
      usage: response.usage,
      decision: (response.toolCall ? JSON.stringify(response.toolCall) : response.content).slice(0, 256),
    }
  }
}

export const inject = ['llm']
export const apply = async (ctx: Context) => { await ctx.plugin(LlmSkillSelection) }
