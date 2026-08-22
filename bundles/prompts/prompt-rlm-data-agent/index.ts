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
  ctx.prompts.section({ name: 'rlm:identity', order: -100, text: section('identity') })
  ctx.prompts.section({ name: 'rlm:repl-protocol', order: 0, text: section('repl-protocol') })
  ctx.prompts.section({ name: 'data:turn-policy', order: 20, text: section('turn-policy') })
  ctx.prompts.section({ name: 'data:evidence-policy', order: 30, text: section('evidence-policy') })
  ctx.prompts.section({ name: 'human-control:policy', order: 40, text: section('human-control') })
  ctx.prompts.section({ name: 'rlm:completion', order: 200, text: section('completion') })
}
