// Prompt là capability của framework: loop chỉ yêu cầu một prompt đã render,
// không sở hữu câu chữ hoặc biết prompt được ráp từ những phần nào.
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    prompts: PromptRegistryService
  }
}

export interface PromptAssembleContext {
  driver?: string
  [key: string]: unknown
}

export interface PromptSection {
  name: string
  order: number
  text: string | ((context: PromptAssembleContext) => string)
}

export interface PromptAssembly {
  sections: Array<{ name: string; text: string }>
}

export interface RenderedPrompt {
  /** Hash của prompt cuối: đủ để trace chính xác composition đã gửi. */
  version: string
  content: string
}

export abstract class PromptRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'prompts')
  }

  abstract section(section: PromptSection): void
  abstract hasSection(name: string): boolean
  abstract assemble(context?: PromptAssembleContext): PromptAssembly
  abstract render(context?: PromptAssembleContext): RenderedPrompt
}
