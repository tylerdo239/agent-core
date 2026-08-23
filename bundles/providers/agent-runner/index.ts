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
import '../../../seams/memory.ts'
import { AgentRunnerService } from '../../../seams/agent.ts'
import { LoopTurnResult, normalizeTurnInput, Session, TurnInput } from '../../../seams/loop.ts'

export class AgentRunner extends AgentRunnerService {
  private activeSessions = new Set<string>()

  async runTurn(driverName: string, session: Session, rawInput: string | TurnInput): Promise<LoopTurnResult> {
    const input = normalizeTurnInput(rawInput)
    if (this.activeSessions.has(session.id)) {
      throw new Error(`session "${session.id}" already has an active turn`)
    }
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
    this.activeSessions.add(session.id)
    try {
      await this.ctx.storage.appendEvent(session.id, {
        type: 'user_message',
        content: input.message,
        selectedSkill: input.selectedSkill,
      })
      // Memory integration (Phase 25): cùng lý do ghi ở entrypoint chung này
      // (coding rule B4) thay vì trong từng loop driver. `ctx.memory` KHÔNG
      // có trong `inject` bên dưới -- seam optional, chỉ mount khi
      // MEMORY_CORE_URL được cấu hình (src/serve.ts).
      //
      // GAP THẬT phát hiện qua verify Docker end-to-end thật (docker compose
      // up --build, memory-tencentdb ĐÃ mount thành công, log "ready" hẳn hoi)
      // -- KHÔNG PHẢI giả thuyết: đọc property `this.ctx.memory` trực tiếp vẫn
      // throw "cannot get property \"memory\" without inject" NGAY CẢ KHI
      // service đã mount ở nơi khác trong app, vì Cordis gate truy cập theo
      // `inject` của ĐÚNG fiber đang đọc (spatial composability -- 1 plugin
      // chỉ thấy service nó tự khai inject, không phải theo "có tồn tại đâu đó
      // trong app hay không"). Với try/catch bọc ngoài như bản cũ, lỗi này bị
      // NUỐT ÂM THẦM mỗi lần -- remember() không BAO GIỜ thực sự gọi tới
      // provider, dù cấu hình đúng 100%. Xác nhận bằng thực nghiệm: gửi tin
      // nhắn thật qua REST, memory-core (log request thật) không nhận được
      // request nào.
      //
      // Fix: dùng `ctx.get(name, strict?)` -- API chính thức của Cordis
      // (node_modules/@deepseek-ai/cordis/src/reflect.ts) đọc service KHÔNG
      // cần khai inject, trả `undefined` êm ái nếu chưa có thay vì throw. Đây
      // mới đúng là cơ chế "optional dependency" Cordis cung cấp sẵn -- không
      // cần tự chế try/catch quanh property access nữa.
      //
      // KHÔNG await remember(): ghi nền, không chặn latency của turn (memory
      // là enhancement, không nằm trên critical path). `.catch()` là lưới an
      // toàn cho phần bất đồng bộ bên trong remember() -- vẫn cần vì serve.ts
      // có process.on('unhandledRejection') gọi process.exit(1) cho TOÀN
      // service, dù bản thân remember() đã best-effort/nuốt lỗi nội bộ.
      this.ctx.get('memory')?.remember(session.id, input.message, { userId: session.ownerId }).catch(() => {})
      // Pin: `driver` là tham chiếu cụ thể, không phải "cái tên" — registry có
      // đổi driver nào đứng sau tên này sau lúc này cũng không ảnh hưởng turn
      // đang chạy.
      return await driver.runTurn(this.ctx, session, input)
    } finally {
      this.activeSessions.delete(session.id)
    }
  }
}

export const inject = ['llm', 'storage', 'tools', 'loop', 'skills']

export const apply = async (ctx: Context) => {
  await ctx.plugin(AgentRunner)
}
