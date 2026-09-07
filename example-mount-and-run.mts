// Ví dụ high-level: dựng một agent tối thiểu, gắn thêm 1 tool tự viết,
// rồi chạy một lượt thật.  Chạy: npx tsx example-mount-and-run.mts
import { Context } from '@deepseek-ai/cordis'

import * as toolRegistry from './bundles/providers/tool-registry/index.ts'
import * as skillRegistry from './bundles/providers/skill-registry/index.ts'
import * as promptRegistry from './bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from './bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from './bundles/providers/context-compactor-llm/index.ts'
import * as stateSqlite from './bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from './bundles/providers/loop-registry/index.ts'
import * as loopDefault from './bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from './bundles/providers/agent-runner/index.ts'

import { LlmService, type LlmCompleteOptions, type LlmCompletion, type LlmMessage } from './seams/llm.ts'
import { Session } from './seams/loop.ts'

// ─────────────────────────────────────────────────────────────────────
// 1. MỘT PROVIDER: thay chỗ của mô hình thật.
//    Kịch bản cố định để ví dụ chạy được offline, không cần API key.
// ─────────────────────────────────────────────────────────────────────
class ScriptedLlm extends LlmService {
  private turn = 0
  async complete(messages: LlmMessage[], _options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    this.turn++
    if (this.turn === 1) {
      // Bước 1: "mô hình" quyết định gọi tool.
      return { content: '', toolCall: { name: 'ty_gia', args: { amount: 100 } } }
    }
    // Bước 2: đọc kết quả tool trong history rồi chốt câu trả lời.
    const toolLine = messages.map((m) => m.content).find((c) => c.includes('vnd'))
    return { content: `100 USD ≈ ${JSON.parse(toolLine!.slice(toolLine!.indexOf('{'))).vnd.toLocaleString('vi-VN')} đồng.` }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 2. MỘT PLUGIN: chức năng tự viết, gắn vào bằng ctx.tools.add.
//    Không sửa lõi, không sửa loop — chỉ thêm file này.
// ─────────────────────────────────────────────────────────────────────
const toolTyGia = Object.assign(
  (ctx: Context) => {
    ctx.tools.add({
      name: 'ty_gia',
      description: 'Đổi USD sang VND theo tỷ giá hiện hành.',
      parameters: {
        type: 'object',
        required: ['amount'],
        properties: { amount: { type: 'number', description: 'số tiền USD' } },
        additionalProperties: false,
      },
      handler: async (args) => ({ usd: args.amount, vnd: Number(args.amount) * 25_400 }),
    })
    // Hướng dẫn dùng tool ĐI KÈM tool: gỡ plugin là mất luôn hướng dẫn.
    ctx.prompts.section({
      name: 'tool:ty_gia',
      order: 120,
      text: 'Dùng `ty_gia` khi người dùng hỏi quy đổi USD sang VND. Không tự nhẩm tỷ giá.',
    })
  },
  { inject: ['tools', 'prompts'] },
)

// ─────────────────────────────────────────────────────────────────────
// 3. LẮP RÁP — đây là composition root thu nhỏ của src/serve.ts
// ─────────────────────────────────────────────────────────────────────
const root = new Context()
root.plugin(toolRegistry)                       // ctx.tools
root.plugin(skillRegistry)                      // ctx.skills
root.plugin(promptRegistry)                     // ctx.prompts
root.plugin(promptDefaultAgent)                 // đóng góp section vào prompt
root.plugin(stateSqlite, { path: ':memory:' })  // ctx.storage
root.plugin(contextCompactorLlm)                // ctx.contextCompactor
root.plugin(ScriptedLlm)                        // ctx.llm
root.plugin(loopRegistry)                       // ctx.loop
root.plugin(loopDefault)                        // đăng ký driver 'default'
root.plugin(agentRunner)                        // ctx.agent
const tyGiaFiber = root.plugin(toolTyGia)       // ← chức năng tự thêm

await new Promise((r) => setTimeout(r, 50))     // chờ chuỗi inject hội tụ

console.log('tool đang có :', root.tools.list().map((t) => t.name))
console.log('prompt section:', root.prompts.assemble({ driver: 'default' }).sections.map((s) => s.name))

// ─────────────────────────────────────────────────────────────────────
// 4. CHẠY MỘT LƯỢT THẬT
// ─────────────────────────────────────────────────────────────────────
const session = new Session('vi-du-1')
const result = await root.agent.runTurn('default', session, { message: '100 USD là bao nhiêu tiền Việt?' })

console.log('\ntrả lời :', result.content)
console.log('số bước :', result.steps)

console.log('\nevent đã ghi vào storage:')
for (const e of (await root.storage.readEvents(session.id)) as any[]) {
  const detail = e.toolCall ? `→ ${e.toolCall.name}(${JSON.stringify(e.toolCall.args)})`
    : e.name ? `← ${e.name} = ${JSON.stringify(e.result)}`
    : (e.content ?? '').slice(0, 60)
  console.log(`  ${String(e.type).padEnd(18)} ${detail}`)
}

// ─────────────────────────────────────────────────────────────────────
// 5. GỠ PLUGIN — tool và hướng dẫn của nó biến mất cùng nhau
// ─────────────────────────────────────────────────────────────────────
await tyGiaFiber.dispose()
console.log('\nsau khi dispose fiber của tool-ty-gia:')
console.log('tool đang có :', root.tools.list().map((t) => t.name))
console.log('prompt section:', root.prompts.assemble({ driver: 'default' }).sections.map((s) => s.name))

await root.fiber.dispose()
