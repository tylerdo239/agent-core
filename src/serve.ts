// src/serve.ts — boot backend service thật: core (Phase 0-5) + auth + REST + WS + gRPC.
//
// Chạy: OPENAI_API_KEY=sk-... OPENAI_BASE_URL=... OPENAI_MODEL_ID=... API_KEYS=key1,key2 npx tsx src/serve.ts
//
// Biến môi trường bắt buộc — thiếu 1 trong 4 là service KHÔNG boot, exit(1)
// ngay lập tức với lỗi rõ ràng (không fail âm thầm sâu bên trong 1 fiber,
// không lộ ra qua stack trace khó đọc):
//   OPENAI_API_KEY     API key gọi model qua ctx.llm (provider mặc định: llm-qwen)
//   OPENAI_BASE_URL    endpoint proxy/model — KHÔNG có default cứng trong code
//                      (identify 1 hạ tầng cụ thể, sai môi trường phải fail
//                      ngay lúc boot, không âm thầm gọi nhầm chỗ)
//   OPENAI_MODEL_ID    tên model trên endpoint đó — cùng lý do không có default
//   API_KEYS           danh sách API key hợp lệ cho REST/WS/gRPC, cách nhau bởi dấu phẩy
// Tuỳ chọn — phần còn lại của config llm-qwen tách qua env:
//   OPENAI_MAX_TOKENS, OPENAI_TIMEOUT_MS, OPENAI_ENABLE_THINKING,
//   OPENAI_EXTRA_BODY (JSON object, merge thẳng vào body request — vd.
//   '{"cache":{"no-cache":true},"timeout":240}', xem lưu ý về thứ tự merge
//   với OPENAI_ENABLE_THINKING ngay tại chỗ dùng bên dưới),
//   STORAGE_PATH, PORT_REST, PORT_WS, PORT_GRPC, PORT_WEB_UI.
// Phase 8 (production hardening round 2, tất cả tuỳ chọn, có default hợp lý):
//   SESSION_TTL_MS, SESSION_SWEEP_INTERVAL_MS (session-registry TTL trượt),
//   OPENAI_MAX_RETRIES, OPENAI_RETRY_BASE_DELAY_MS (llm-qwen retry transient),
//   STORAGE_RETENTION_DAYS, STORAGE_RETENTION_SWEEP_INTERVAL_MS (state-sqlite
//   prune — KHÔNG set STORAGE_RETENTION_DAYS = không prune gì).
// Audit fix (đối chiếu docs/agent-core-master-summary.md): WEB_SEARCH_TIMEOUT_MS
//   (tool-web-search fetch() timeout — mặc định 10s, trước đây không có gì).
//
// Provider llm mặc định là `llm-qwen` (bundles/providers/llm-qwen) — wrap
// proxy OpenAI-compatible của model Qwen3.5 dùng trong production ở repo
// `data-agent`. `llm-deepseek` (bundles/providers/llm-deepseek) vẫn còn
// trong repo như 1 provider thay thế hợp lệ — đổi lại import + biến môi
// trường tương ứng nếu muốn dùng lại, không cần sửa gì khác (đúng tinh thần
// spatial composability: đổi provider của 1 seam không ảnh hưởng phần còn
// lại của hệ thống).
import { Context, Logger } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as llmQwen from '../bundles/providers/llm-qwen/index.ts'
import * as subagentManager from '../bundles/providers/subagent-manager/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
// skill-support-tone: ví dụ #1 cho ctx.skills — chèn hướng dẫn giọng văn hỗ
// trợ khi tin nhắn user có dấu hiệu khiếu nại/sự cố. Xem bundles/skills/
// skill-support-tone cho danh sách trigger + nội dung instructions đầy đủ.
import * as skillSupportTone from '../bundles/skills/skill-support-tone/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as toolDatabaseQuery from '../bundles/tools/tool-database-query/index.ts'
// tool-web-search: search thật qua DuckDuckGo HTML endpoint (không cần API
// key), trả về title/url/snippet thật — xem bundles/tools/tool-web-search
// cho chi tiết parser + rủi ro markup DuckDuckGo có thể đổi.
import * as toolWebSearch from '../bundles/tools/tool-web-search/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as authApiKey from '../bundles/providers/auth-apikey/index.ts'
import * as apiRest from '../bundles/adapters/api-rest/index.ts'
import * as apiWs from '../bundles/adapters/api-ws/index.ts'
import * as apiGrpc from '../bundles/adapters/api-grpc/index.ts'
import * as webUi from '../bundles/adapters/web-ui/index.ts'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`FATAL: missing required env var ${name} — service không thể boot an toàn, dừng ngay.`)
    process.exit(1)
  }
  return value
}

function optionalNumber(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const n = Number(raw)
  if (Number.isNaN(n)) {
    console.error(`FATAL: env var ${name} phải là số, nhận được "${raw}".`)
    process.exit(1)
  }
  return n
}

function optionalBoolean(name: string): boolean | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  return raw === 'true' || raw === '1'
}

function optionalJsonObject(name: string): Record<string, unknown> | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err: any) {
    console.error(`FATAL: env var ${name} phải là JSON hợp lệ — lỗi parse: ${err.message}`)
    process.exit(1)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.error(`FATAL: env var ${name} phải là JSON object (vd. {"key":"value"}), nhận được: ${raw}`)
    process.exit(1)
  }
  return parsed as Record<string, unknown>
}

// Đăng ký TRƯỚC khi làm bất kỳ việc gì khác — 1 lỗi không lường trước ở bất
// kỳ đâu trong quá trình boot/chạy phải được log rõ ràng và dừng process có
// kiểm soát, không được chết âm thầm hoặc chạy tiếp ở trạng thái không chắc
// còn đúng.
process.on('uncaughtException', (err) => {
  console.error('FATAL uncaughtException:', err)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  console.error('FATAL unhandledRejection:', reason)
  process.exit(1)
})

async function main() {
  const openaiApiKey = requireEnv('OPENAI_API_KEY')
  // llm-qwen tự validate 3 field này trong [Service.init]() nếu ai mount nó
  // trực tiếp (không qua serve.ts) — nhưng lỗi đó throw SÂU bên trong 1
  // Cordis fiber, KHÔNG làm process.exit(): agent-runner/api-rest/api-ws/
  // api-grpc chỉ đứng yên ở PENDING mãi mãi (đã verify: fiber.await() không
  // đợi fiber còn PENDING), trong khi log dưới đây vẫn in ra như đã chạy
  // thành công — silent failure thật, không phải giả thuyết. Bắt buộc ở
  // đây để fail nhanh, ồn ào, đúng lúc boot — không dựa một mình vào
  // validate bên trong provider.
  const openaiBaseUrl = requireEnv('OPENAI_BASE_URL')
  const openaiModelId = requireEnv('OPENAI_MODEL_ID')
  const apiKeys = requireEnv('API_KEYS')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (!apiKeys.length) {
    console.error('FATAL: API_KEYS rỗng sau khi parse — cần ít nhất 1 key hợp lệ.')
    process.exit(1)
  }

  const root = new Context()

  const exporter = {
    export: (message: Parameters<typeof Logger.format>[1]) => {
      const line = `[${message.name}] ${Logger.format(exporter, message)}`
      if (message.type === 'error') console.error(line)
      else console.log(line)
    },
  }
  root.logger.exporter(exporter)

  root.plugin(toolRegistry)
  root.plugin(stateSqlite, {
    path: process.env.STORAGE_PATH ?? 'data/sessions.db',
    // Phase 8.4: KHÔNG set STORAGE_RETENTION_DAYS = không prune gì (mặc
    // định, backward compatible) — xem bundles/providers/state-sqlite.
    retentionDays: optionalNumber('STORAGE_RETENTION_DAYS'),
    retentionSweepIntervalMs: optionalNumber('STORAGE_RETENTION_SWEEP_INTERVAL_MS'),
  })
  // deny-by-default — chỉ mở đúng action tool-web-search cần
  // (actor "web-search", action "search"); tool nào khác cần permission
  // trong tương lai phải tự thêm rule riêng, không "mở hết" cho tiện.
  root.plugin(permissionRbac, { rules: { 'web-search': ['search'] } })
  root.plugin(llmQwen, {
    apiKey: openaiApiKey,
    baseUrl: openaiBaseUrl,
    model: openaiModelId,
    maxTokens: optionalNumber('OPENAI_MAX_TOKENS'),
    timeoutMs: optionalNumber('OPENAI_TIMEOUT_MS'),
    enableThinking: optionalBoolean('OPENAI_ENABLE_THINKING'),
    // LƯU Ý: extraBody merge SAU chat_template_kwargs suy ra từ
    // OPENAI_ENABLE_THINKING (xem bundles/providers/llm-qwen/index.ts) — nếu
    // OPENAI_EXTRA_BODY cũng có key "chat_template_kwargs", nó THẮNG hoàn
    // toàn (shallow merge, không deep-merge), OPENAI_ENABLE_THINKING bị lờ
    // đi. Đặt field enable_thinking đúng NGAY TRONG OPENAI_EXTRA_BODY nếu
    // dùng cả 2, tránh set khác giá trị nhau ở 2 chỗ.
    extraBody: optionalJsonObject('OPENAI_EXTRA_BODY'),
    // Phase 8.3: retry cho lỗi transient (network/429/5xx) — không retry
    // 4xx khác (auth/request sai, fail y hệt lần nữa).
    maxRetries: optionalNumber('OPENAI_MAX_RETRIES'),
    retryBaseDelayMs: optionalNumber('OPENAI_RETRY_BASE_DELAY_MS'),
  })
  root.plugin(subagentManager)
  root.plugin(skillRegistry)
  root.plugin(skillSupportTone)
  root.plugin(loopRegistry)
  root.plugin(loopDefault)
  // Muốn hot-swap sang loop-planner-critic khi đang chạy: KHÔNG mount cả 2
  // cùng lúc (cùng đăng ký tên 'default', mount lần 2 sẽ throw "already
  // registered") — dispose fiber loop-default trước, đúng pattern
  // tests/chaos-hot-swap.test.ts.
  root.plugin(agentRunner)
  root.plugin(sessionRegistry, {
    // Phase 8.1: TTL trượt theo hoạt động — xem bundles/providers/session-registry.
    ttlMs: optionalNumber('SESSION_TTL_MS'),
    sweepIntervalMs: optionalNumber('SESSION_SWEEP_INTERVAL_MS'),
  })
  root.plugin(authApiKey, { keys: apiKeys })
  root.plugin(toolDatabaseQuery)
  root.plugin(toolWebSearch, {
    // Audit fix: trước đây không có timeout, fetch() có thể treo cả turn vô
    // thời hạn nếu DuckDuckGo không phản hồi — xem bundles/tools/tool-web-search.
    timeoutMs: optionalNumber('WEB_SEARCH_TIMEOUT_MS'),
  })

  const restConfig = { port: Number(process.env.PORT_REST ?? 8787) }
  const wsConfig = { port: Number(process.env.PORT_WS ?? 8788) }
  const grpcConfig = { port: Number(process.env.PORT_GRPC ?? 50051) }
  const webUiConfig = { port: Number(process.env.PORT_WEB_UI ?? 8790) }
  await root.plugin(apiRest, restConfig)
  await root.plugin(apiWs, wsConfig)
  await root.plugin(apiGrpc, grpcConfig)
  await root.plugin(webUi, webUiConfig)

  console.log(`\nWeb UI  http://localhost:${webUiConfig.port}  (nhập API key trong ⚙ lúc mở lần đầu)`)
  console.log(`REST    http://localhost:${restConfig.port}  (Authorization: Bearer <key>, trừ /health /ready)`)
  console.log(`WS      ws://localhost:${wsConfig.port}  (Authorization header hoặc ?key=<key>)`)
  console.log(`gRPC    localhost:${grpcConfig.port}  (metadata "authorization")\n`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      console.log(`\n${signal} — shutting down...`)
      await root.fiber.dispose()
      process.exit(0)
    })
  }
}

main().catch((err) => {
  console.error('FATAL during boot:', err)
  process.exit(1)
})
