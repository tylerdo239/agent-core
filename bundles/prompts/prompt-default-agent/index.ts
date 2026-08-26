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
  // Những section này không được rò sang RLM; tool guidance dùng chung sẽ
  // được chính tool plugin đăng ký mà không khai báo `drivers`.
  const drivers = ['default']
  ctx.prompts.section({
    name: 'default:identity',
    order: -100,
    drivers,
    text: section('identity'),
  })
  ctx.prompts.section({
    name: 'default:operating-policy',
    order: 20,
    drivers,
    text: section('operating-policy'),
  })
  ctx.prompts.section({
    name: 'default:completion',
    order: 200,
    drivers,
    text: section('completion'),
  })
}
