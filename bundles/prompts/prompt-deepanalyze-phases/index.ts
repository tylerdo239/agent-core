import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/prompt.ts'

function section(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./sections/${name}.md`, import.meta.url)),
    'utf8',
  ).trim()
}

export const inject = ['prompts']

export const apply = (ctx: Context) => {
  // order 15 sits between repl-protocol (0) and turn-policy (20):
  // the phase discipline must be known before turn picking, but after the
  // strict fence rules.
  ctx.prompts.section({
    name: 'data:deepanalyze-phases',
    order: 15,
    drivers: ['rlm'],
    text: section('deepanalyze-phases'),
  })
}
