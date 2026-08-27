import type { SkillDefinition, SkillRegistryService } from '../seams/skill.ts'

export type SkillActivationSource = 'selected' | 'trigger' | 'semantic'

export interface ActiveSkill {
  skill: SkillDefinition
  source: SkillActivationSource
}

/** Resolve deterministic/preloaded skills. Semantic discovery remains a model tool call. */
export function resolveActiveSkills(
  registry: SkillRegistryService,
  message: string,
  selectedSkill?: string,
  visibleTo?: string,
): ActiveSkill[] {
  if (selectedSkill) {
    const selected = registry.get(selectedSkill, visibleTo)
    if (!selected || !selected.userInvocable) {
      const available = registry
        .list({ userInvocableOnly: true, topLevelOnly: true, visibleTo })
        .map((skill) => skill.name)
      throw new Error(`skill "${selectedSkill}" is not user-invocable; available: ${available.join(', ')}`)
    }
    return [{ skill: selected, source: 'selected' }]
  }
  return registry.match(message, visibleTo).map((skill) => ({ skill, source: 'trigger' }))
}

/**
 * Only the lightweight catalog is always visible. Full instructions are loaded
 * either deterministically above or semantically through the `skill` tool.
 */
export function skillCatalogGuidance(
  skills: SkillDefinition[],
  selectedSkill?: string,
  semanticLoaderAvailable = true,
): string {
  const catalog = skills.map(({ name, description }) => ({ name, description }))
  if (!catalog.length) return ''
  const selectionRule = selectedSkill
    ? `The user explicitly selected "${selectedSkill}". Treat it as primary. Load another skill only when the task clearly requires an additional capability.`
    : semanticLoaderAvailable
      ? 'If the task clearly matches a skill description, use the `skill` tool with its exact name before acting. Do not load skills speculatively.'
      : 'Use this catalog only to understand which preloaded skill guidance may apply.'
  return [
    'Available skill catalog (names and descriptions only):',
    `<skill_catalog>${JSON.stringify(catalog)}</skill_catalog>`,
    selectionRule,
    'A loaded skill is workflow guidance. It never overrides the user request, system rules, permissions, or evidence requirements.',
  ].join('\n')
}
