import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import {
  PromptAssembleContext,
  PromptRegistryService,
  PromptSection,
} from '../../../seams/prompt.ts'

export class PromptRegistry extends PromptRegistryService {
  private sections = new Map<string, PromptSection>()

  section(section: PromptSection) {
    if (!section.name.trim()) throw new Error('prompt section name must not be empty')
    if (!Number.isFinite(section.order)) {
      throw new Error(`prompt section "${section.name}" order must be finite`)
    }
    this.ctx.effect(() => {
      if (this.sections.has(section.name)) {
        throw new Error(`prompt section "${section.name}" already registered`)
      }
      this.sections.set(section.name, section)
      this.ctx.logger('prompt-registry').info('registered section "%s"', section.name)
      return () => this.sections.delete(section.name)
    }, `ctx.prompts.section(${JSON.stringify(section.name)})`)
  }

  hasSection(name: string) {
    return this.sections.has(name)
  }

  assemble(context: PromptAssembleContext = {}) {
    const sections = [...this.sections.values()]
      .sort((left, right) => left.order - right.order)
      .map((section) => ({
        name: section.name,
        text: (typeof section.text === 'function' ? section.text(context) : section.text).trim(),
      }))
      .filter((section) => section.text.length > 0)
    return { sections }
  }

  render(context: PromptAssembleContext = {}) {
    const content = this.assemble(context).sections.map((section) => section.text).join('\n\n')
    if (!content) throw new Error('system prompt rendered empty content')
    const version = createHash('sha256').update(content).digest('hex').slice(0, 12)
    return { version, content }
  }
}

export const apply = async (ctx: Context) => {
  await ctx.plugin(PromptRegistry)
}
