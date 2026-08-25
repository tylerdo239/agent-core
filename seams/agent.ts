// seams/agent.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/agent-runner.
//
// Đây là entrypoint CÔNG KHAI, ỔN ĐỊNH để chạy 1 turn — khác với `ctx.loop`
// (chỉ là sổ đăng ký tên → driver). Lý do cần tách riêng seam này (Phase 5):
// bundle đăng ký driver (vd. loop-default) có thể bị dispose giữa chừng khi
// hot-swap; nếu code gọi turn trực tiếp cầm tham chiếu vào 1 fiber có thể
// biến mất, không có gì đảm bảo turn đang chạy dở sống sót qua swap.
// `AgentRunnerService` được mount 1 lần, KHÔNG bị đụng tới khi swap loop
// driver, nên `this.ctx` bên trong nó luôn ổn định — đúng nơi để "pin" driver
// tại thời điểm bắt đầu turn (coding rule B4).
import { Context, Service } from '@deepseek-ai/cordis'
import { LoopTurnResult, Session, TurnInput } from './loop.ts'
import type { RunRecord } from './storage.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agent: AgentRunnerService
  }
}

export abstract class AgentRunnerService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agent')
  }

  abstract runTurn(driverName: string, session: Session, input: string | TurnInput): Promise<LoopTurnResult>
  abstract getRun(runId: string): Promise<RunRecord | undefined>
  abstract listRuns(sessionId: string): Promise<RunRecord[]>
  abstract cancelRun(runId: string): Promise<boolean>
  abstract drain(deadlineMs?: number): Promise<void>
}
