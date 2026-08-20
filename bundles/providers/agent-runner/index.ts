// bundles/agent-runner — provider cho seam ctx.agent (Phase 5).
//
// Mount 1 lần cho toàn app, inject đủ llm/storage/tools/loop/skills — KHÔNG phải
// mục tiêu hot-swap. `runTurn()` tra driver từ ctx.loop NGAY LÚC BẮT ĐẦU
// turn rồi truyền `this.ctx` (ổn định — xem seams/agent.ts) làm `runCtx`
// cho driver; driver không tự tra ctx.loop lại giữa chừng, nên dù registry
// đổi driver mặc định sau đó, turn đang chạy vẫn tiếp tục với driver ĐÃ PIN
// (coding rule B4) — đây là cơ chế thật đứng sau chaos test Phase 5.
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/llm.ts'
import '../../../seams/storage.ts'
import '../../../seams/tools.ts'
import '../../../seams/loop.ts'
import '../../../seams/skill.ts'
import { AgentRunnerService } from '../../../seams/agent.ts'
import { LoopTurnResult, Session } from '../../../seams/loop.ts'

export class AgentRunner extends AgentRunnerService {
  async runTurn(driverName: string, session: Session, userMessage: string): Promise<LoopTurnResult> {
    const driver = this.ctx.loop.get(driverName)
    if (!driver) {
      throw new Error(`loop driver "${driverName}" not found`)
    }
    // Gap thật phát hiện khi build sidebar/resume-session (thêm sau audit
    // UI): trước đây KHÔNG driver nào lưu tin nhắn USER vào storage — chỉ
    // model_message/tool_result/critic_message được lưu. GET
    // /sessions/:id/events vì vậy chỉ thấy câu trả lời, mất hết câu hỏi gốc.
    // Ghi Ở ĐÂY (entrypoint ổn định chung cho MỌI driver, coding rule B4) —
    // không lặp lại logic này trong từng loop driver riêng.
    await this.ctx.storage.appendEvent(session.id, { type: 'user_message', content: userMessage })
    // Pin: `driver` là tham chiếu cụ thể, không phải "cái tên" — registry có
    // đổi driver nào đứng sau tên này sau lúc này cũng không ảnh hưởng turn
    // đang chạy.
    return driver.runTurn(this.ctx, session, userMessage)
  }
}

export const inject = ['llm', 'storage', 'tools', 'loop', 'skills']

export const apply = async (ctx: Context) => {
  await ctx.plugin(AgentRunner)
}
