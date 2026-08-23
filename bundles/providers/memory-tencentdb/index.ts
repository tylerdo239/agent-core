// bundles/providers/memory-tencentdb — provider cho seam ctx.memory.
//
// Wrap TencentDB Agent Memory's MemoryCore (memory-db/MemoryCore, xem
// docs/agent-core-memory-integration-plan.md) qua SDK chính thức
// @tencentdb-agent-memory/memory-sdk-ts-v2 (v3 strict-isolation client).
//
// teamId/agentId là hằng số CẤP DEPLOYMENT (không phải tham số per-call của
// seam) -- 1 agent-core deployment ứng với 1 team/agent cố định trong
// MemoryCore. Scoping theo TỪNG NGƯỜI DÙNG (userId, map từ Session.ownerId)
// mới cần đổi per-call -- dùng withIsolation() để tạo 1 client "phái sinh"
// từ 1 base client dùng chung cho cả app (KHÔNG tạo 1 MemoryClient/user).
//
// Timeout (coding rule A17): SDK's HttpTransport.post() (đã đọc trực tiếp
// node_modules/@tencentdb-agent-memory/memory-sdk-ts-v2/dist/http.js để xác
// nhận, không đoán) tự dựng AbortController + setTimeout(controller.abort,
// this.timeout) quanh MỖI fetch() thật -- cấu hình qua field `timeout` lúc
// khởi tạo MemoryClientConfig. withIsolation() tái dùng NGUYÊN 1
// HttpTransport (cùng timeout) cho mọi client phái sinh, nên chỉ cần set
// 1 lần lúc dựng base client. Vì cơ chế hủy thật đã có sẵn + đã verify, KHÔNG
// cần bọc thêm 1 lớp AbortController/Promise.race giả ở provider này.
//
// remember()/recall() PHẢI best-effort: memory là enhancement, KHÔNG nằm
// trên critical path của lượt chat (triết lý ở mục quyết định #2 trong plan)
// -- timeout/lỗi/service down chỉ log rồi bỏ qua (remember) hoặc trả mảng
// rỗng (recall), KHÔNG BAO GIỜ throw lên loop driver.
import { Context, Service } from '@deepseek-ai/cordis'
// Gói export CẢ client v2 (`MemoryClient`, dùng teamId/agentId/userId qua
// IdFields optional per-request) LẪN v3 (`V3MemoryClient`, strict-isolation,
// bind teamId/agentId/userId lúc khởi tạo + withIsolation() per-call) --
// dùng v3 vì đúng model isolation cần ở đây (xem seams/memory.ts MemoryContext).
import { V3MemoryClient as MemoryClient } from '@tencentdb-agent-memory/memory-sdk-ts-v2'
import { MemoryContext, MemoryEntry, MemoryService } from '../../../seams/memory.ts'

export namespace MemoryTencentdb {
  export interface Config {
    /** Base URL gateway MemoryCore, vd. http://memory-core:8080 -- hạ tầng cụ thể, không có default cứng (cùng lý do llm-qwen không default baseUrl: sai môi trường phải fail rõ lúc boot, không âm thầm gọi nhầm chỗ). */
    endpoint: string
    apiKey: string
    /** Memory instance ID (gửi qua header x-tdai-service-id). */
    serviceId: string
    /** Cấp deployment, KHÔNG phải per-call. Mặc định 'agent-core'. */
    teamId?: string
    /** Cấp deployment, KHÔNG phải per-call. Mặc định 'default'. */
    agentId?: string
    /** Timeout mỗi lần gọi MemoryCore, ms. Mặc định 10s -- đọc/ghi memory phải nhanh, không cùng ngân sách với LLM call (llm-qwen mặc định 60s). */
    timeoutMs?: number
  }
}

const DEFAULT_TEAM_ID = 'agent-core'
const DEFAULT_AGENT_ID = 'default'
const DEFAULT_TIMEOUT_MS = 10_000
// Placeholder cho BASE client -- mọi call thật đều đi qua scopedClient()
// (withIsolation({ userId })), giá trị userId gốc này không bao giờ chạm
// network với vai trò userId thật. V3MemoryClientConfig bắt userId bắt buộc
// lúc khởi tạo (dù sẽ luôn bị override ngay khi dùng).
const UNSCOPED_USER_ID = 'unscoped'

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class MemoryTencentdb extends MemoryService {
  private client!: MemoryClient
  private readonly timeoutMs: number

  constructor(
    ctx: Context,
    public config: MemoryTencentdb.Config,
  ) {
    super(ctx)
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  [Service.init]() {
    const { endpoint, apiKey, serviceId } = this.config
    const missing = [!endpoint && 'endpoint', !apiKey && 'apiKey', !serviceId && 'serviceId'].filter(Boolean)
    if (missing.length) {
      throw new Error(`memory-tencentdb: missing required config: ${missing.join(', ')}`)
    }
    const teamId = this.config.teamId ?? DEFAULT_TEAM_ID
    const agentId = this.config.agentId ?? DEFAULT_AGENT_ID
    this.client = new MemoryClient({
      endpoint,
      apiKey,
      serviceId,
      teamId,
      agentId,
      userId: UNSCOPED_USER_ID,
      timeout: this.timeoutMs,
    })
    this.ctx.logger('memory-tencentdb').info('ready (endpoint=%s, teamId=%s, agentId=%s)', endpoint, teamId, agentId)
  }

  private scopedClient(context?: MemoryContext): MemoryClient {
    return this.client.withIsolation({ userId: context?.userId ?? 'anonymous' })
  }

  async remember(sessionId: string, text: string, context?: MemoryContext): Promise<void> {
    try {
      const client = this.scopedClient(context)
      await client.addConversation({
        session_id: sessionId,
        messages: [{ role: 'user', content: text }],
      })
    } catch (err) {
      this.ctx.logger('memory-tencentdb').warn('remember thất bại (bỏ qua, không chặn turn): %s', errMessage(err))
    }
  }

  async recall(sessionId: string, query: string, limit = 3, context?: MemoryContext): Promise<MemoryEntry[]> {
    try {
      const client = this.scopedClient(context)
      // searchConversation = L0 (raw conversation, có ngay lập tức). searchAtomic
      // (L1 facts) chạy qua pipeline nền BẤT ĐỒNG BỘ -- 1 remember() vừa gọi
      // xong sẽ KHÔNG kịp xuất hiện ở đó, phá vỡ hợp đồng remember->recall
      // đồng bộ mà seam này cần (xem mục quyết định #2, plan chính).
      const result = await client.searchConversation({ session_id: sessionId, query, limit })
      return result.messages.map((hit, i) => ({
        id: hit.id ?? `${sessionId}:${i}`,
        text: hit.content,
        score: hit.score,
      }))
    } catch (err) {
      this.ctx.logger('memory-tencentdb').warn('recall thất bại (trả mảng rỗng, không chặn turn): %s', errMessage(err))
      return []
    }
  }
}

export const apply = async (ctx: Context, config: MemoryTencentdb.Config) => {
  await ctx.plugin(MemoryTencentdb, config)
}
