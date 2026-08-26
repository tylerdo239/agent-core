import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/prompt.ts'
import { currentDateNote } from '../../../seams/loop.ts'

function section(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./sections/${name}.md`, import.meta.url)),
    'utf8',
  ).trim()
}

export const inject = ['prompts']

export const apply = (ctx: Context) => {
  // Follow-up (2026-08) — filter thời gian cho skill nghiên cứu/phân tích
  // (xem seams/loop.ts, currentDateNote — cùng nội dung dùng cho loop-
  // default qua Session.buildPrompt()). RLM gọi `prompts.render()` MỚI MỖI
  // LƯỢT (bundles/loop-drivers/loop-rlm/protocol.ts), nên hàm `text` ở đây
  // được tính LẠI mỗi lần — không "đông cứng" theo lúc session RLM được tạo.
  ctx.prompts.section({ name: 'context:current-date', order: -90, text: () => currentDateNote() })
  ctx.prompts.section({ name: 'rlm:identity', order: -100, text: section('identity') })
  ctx.prompts.section({ name: 'rlm:repl-protocol', order: 0, text: section('repl-protocol') })
  ctx.prompts.section({ name: 'data:turn-policy', order: 20, text: section('turn-policy') })
  ctx.prompts.section({ name: 'data:evidence-policy', order: 30, text: section('evidence-policy') })
  ctx.prompts.section({ name: 'human-control:policy', order: 40, text: section('human-control') })
  ctx.prompts.section({ name: 'rlm:completion', order: 200, text: section('completion') })
}
