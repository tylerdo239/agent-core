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

// Merge feat/rlm-dev-integration: "filter thời gian" (business-case-builder)
// từng tự thêm 1 section 'context:current-date' riêng ở đây (đọc
// seams/loop.ts's currentDateNote()) — RETIRE, đã có src/environment-note.ts
// làm việc này TỐT HƠN cho cả 2 driver (đã bisect thật vị trí chèn tối ưu
// theo driver — 'end' cho default, 'identity' cho rlm, xem ghi chú tại
// environment-note.ts) — gọi từ loop-default/index.ts và loop-rlm/protocol.ts,
// không cần khai qua prompt section ở đây nữa.
export const apply = (ctx: Context) => {
  const drivers = ['rlm']
  ctx.prompts.section({ name: 'rlm:identity', order: -100, drivers, text: section('identity') })
  ctx.prompts.section({ name: 'rlm:repl-protocol', order: 0, drivers, text: section('repl-protocol') })
  ctx.prompts.section({ name: 'data:turn-policy', order: 20, drivers, text: section('turn-policy') })
  ctx.prompts.section({ name: 'data:evidence-policy', order: 30, drivers, text: section('evidence-policy') })
  ctx.prompts.section({ name: 'human-control:policy', order: 40, drivers, text: section('human-control') })
  ctx.prompts.section({ name: 'rlm:completion', order: 200, drivers, text: section('completion') })
}
