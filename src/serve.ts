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
//   DATABASE_URL       connection string Postgres cho ctx.auth (bundles/providers/auth-users)
//                      — tài khoản/token nhiều người dùng thật, KHÔNG còn API_KEYS dùng chung
// Tuỳ chọn — phần còn lại của config llm-qwen tách qua env:
//   OPENAI_MAX_TOKENS, OPENAI_TIMEOUT_MS, OPENAI_ENABLE_THINKING,
//   OPENAI_EXTRA_BODY (JSON object, merge thẳng vào body request — vd.
//   '{"cache":{"no-cache":true},"timeout":240}', xem lưu ý về thứ tự merge
//   với OPENAI_ENABLE_THINKING ngay tại chỗ dùng bên dưới),
//   STORAGE_PATH, PORT_REST (dùng chung cho cả REST và WS upgrade từ Phase
//   6.3 — xem bundles/adapters/api-rest), PORT_GRPC, PORT_WEB_UI.
// Phase 8 (production hardening round 2, tất cả tuỳ chọn, có default hợp lý):
//   SESSION_TTL_MS, SESSION_SWEEP_INTERVAL_MS (session-registry TTL trượt),
//   OPENAI_MAX_RETRIES, OPENAI_RETRY_BASE_DELAY_MS (llm-qwen retry transient),
//   STORAGE_RETENTION_DAYS, STORAGE_RETENTION_SWEEP_INTERVAL_MS (state-sqlite
//   prune — KHÔNG set STORAGE_RETENTION_DAYS = không prune gì).
// Audit fix (đối chiếu docs/agent-core-master-summary.md): WEB_SEARCH_TIMEOUT_MS
//   (tool-web-search fetch() timeout — mặc định 10s, trước đây không có gì).
// SERPER_API_KEY (tuỳ chọn) — tool-web-search dùng Serper.dev làm provider
//   CHÍNH, DuckDuckGo tự dự phòng khi Serper lỗi/hết hạn mức. Không set =
//   chạy y hệt trước đây (DuckDuckGo only).
// EXTRA_PLUGINS, EXTRA_PLUGIN_CONFIG__<name> (tuỳ chọn — bên thứ ba thêm
//   plugin KHÔNG cần sửa file này, xem docs/agent-core-adding-plugins.md).
//
// Provider llm mặc định là `llm-qwen` (bundles/providers/llm-qwen) — wrap
// proxy OpenAI-compatible của model Qwen3.5 dùng trong production ở repo
// `data-agent`. `llm-deepseek` (bundles/providers/llm-deepseek) vẫn còn
// trong repo như 1 provider thay thế hợp lệ — đổi lại import + biến môi
// trường tương ứng nếu muốn dùng lại, không cần sửa gì khác (đúng tinh thần
// spatial composability: đổi provider của 1 seam không ảnh hưởng phần còn
// lại của hệ thống).
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context, Logger } from '@deepseek-ai/cordis'
import { parseJsonObjectEnv } from './env.ts'
import { extraPluginConfig, isPluginModule, parseExtraPlugins } from './extra-plugins.ts'
import * as pluginInventory from '../bundles/providers/plugin-inventory/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as llmQwen from '../bundles/providers/llm-qwen/index.ts'
import * as contextCompactorLlm from '../bundles/providers/context-compactor-llm/index.ts'
import * as subagentManager from '../bundles/providers/subagent-manager/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as skillSelectionLlm from '../bundles/providers/skill-selection-llm/index.ts'
import * as skillFilesystem from '../bundles/providers/skill-filesystem/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from '../bundles/prompts/prompt-default-agent/index.ts'
import * as promptRlmDataAgent from '../bundles/prompts/prompt-rlm-data-agent/index.ts'
import * as promptDeepanalyzePhases from '../bundles/prompts/prompt-deepanalyze-phases/index.ts'
import * as memoryRolling from '../bundles/providers/memory-rolling/index.ts'
import * as workspaceLocal from '../bundles/providers/workspace-local/index.ts'
import * as workspaceDocker from '../bundles/providers/workspace-docker/index.ts'
import * as artifactService from '../bundles/providers/artifact-service/index.ts'
import * as jobRunner from '../bundles/providers/job-runner/index.ts'
import * as pipelineRegistry from '../bundles/providers/pipeline-registry/index.ts'
import * as pipelineRunner from '../bundles/providers/pipeline-runner/index.ts'
import * as sandboxIpython from '../bundles/providers/sandbox-ipython/index.ts'
import * as sandboxDocker from '../bundles/providers/sandbox-docker/index.ts'
// skill-support-tone: ví dụ #1 cho ctx.skills — chèn hướng dẫn giọng văn hỗ
// trợ khi tin nhắn user có dấu hiệu khiếu nại/sự cố. Xem bundles/skills/
// skill-support-tone cho danh sách trigger + nội dung instructions đầy đủ.
import * as skillSupportTone from '../bundles/skills/skill-support-tone/index.ts'
import * as loopRegistry from '../bundles/providers/loop-registry/index.ts'
import * as loopDefault from '../bundles/loop-drivers/loop-default/index.ts'
import * as loopRlm from '../bundles/loop-drivers/loop-rlm/index.ts'
import * as agentRunner from '../bundles/providers/agent-runner/index.ts'
import * as toolDatabaseQuery from '../bundles/tools/tool-database-query/index.ts'
// tool-web-search: search thật qua DuckDuckGo HTML endpoint (không cần API
// key), trả về title/url/snippet thật — xem bundles/tools/tool-web-search
// cho chi tiết parser + rủi ro markup DuckDuckGo có thể đổi.
import * as toolWebSearch from '../bundles/tools/tool-web-search/index.ts'
import * as toolSkill from '../bundles/tools/tool-skill/index.ts'
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as projectRegistry from '../bundles/providers/project-registry/index.ts'
import * as authUsers from '../bundles/providers/auth-users/index.ts'
import * as pluginConfigPostgres from '../bundles/providers/plugin-config-postgres/index.ts'
import * as customSkillStorePostgres from '../bundles/providers/custom-skill-store-postgres/index.ts'
import * as memoryTencentdb from '../bundles/providers/memory-tencentdb/index.ts'
import * as apiRest from '../bundles/adapters/api-rest/index.ts'
import * as apiGrpc from '../bundles/adapters/api-grpc/index.ts'
import * as webUi from '../bundles/adapters/web-ui/index.ts'
import * as stageDataLoad from '../bundles/pipelines/stages/data-load/index.ts'
import * as stageFeatureBasic from '../bundles/pipelines/stages/feature-basic/index.ts'
import * as stageTrainMajority from '../bundles/pipelines/stages/train-majority/index.ts'
import * as stageTrainFlaml from '../bundles/pipelines/stages/train-flaml/index.ts'
import * as stageValidateHoldout from '../bundles/pipelines/stages/validate-split/index.ts'
import * as stageReportMarkdown from '../bundles/pipelines/stages/report-markdown/index.ts'
import * as pipelineTabularClassification from '../bundles/pipelines/pipeline-tabular-classification/index.ts'

const agentCoreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localEnvPath = path.join(agentCoreRoot, '.env')
if (existsSync(localEnvPath)) {
  // `npm run serve` phải tự đủ: đọc đúng config thuộc agent-core, không yêu
  // cầu user source file của repo khác. Environment đã export vẫn giữ
  // precedence theo hành vi chuẩn của process.loadEnvFile().
  process.loadEnvFile(localEnvPath)
  console.log(`[config] loaded ${localEnvPath}`)
}

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
  try {
    const parsed = parseJsonObjectEnv(raw)
    if (parsed.repaired) {
      console.warn(
        `WARN: env var ${name} bị shell bỏ dấu nháy quanh JSON keys; `
        + 'đã sửa an toàn. Không dùng source/export-xargs để nạp file .env.',
      )
    }
    return parsed.value
  } catch (err: any) {
    console.error(`FATAL: env var ${name} phải là JSON hợp lệ — lỗi parse: ${err.message}`)
    process.exit(1)
  }
}

// Module memory (ctx.memory, TÙY CHỌN — xem
// docs/agent-core-memory-integration-plan.md): MemoryCore đòi 1 lần
// bootstrap admin user qua POST /v3/internal/meta/user/init-admin lúc
// service KHỞI TẠO LẦN ĐẦU (idempotent — gọi lại sau vẫn 200/409, không
// lỗi). docker-compose KHÔNG có primitive "chạy script sau khi container
// khác healthy" thuần túy, nên bootstrap này chạy Ở ĐÂY (ngay trong boot
// sequence của agent-core, TRƯỚC khi mount memory-tencentdb) — không phải
// 1 job/script riêng.
//
// Retry-with-backoff giống hệt lý do auth-users cần retry cho Postgres:
// memory-core KHÔNG nằm trong depends_on của agent-core (cả 2 container
// start song song, xem docker-compose.yml) — memory-core có thể chưa kịp
// healthy lúc agent-core chạy tới đây.
//
// QUAN TRỌNG: bootstrap thất bại sau hết số lần retry KHÔNG làm service
// exit(1) — memory là enhancement, không nằm trên critical path (đúng
// triết lý xuyên suốt: remember()/recall() best-effort, seam optional,
// không có trong `inject` của agent-runner). Log cảnh báo rồi bỏ qua việc
// mount memory-tencentdb, agent-core vẫn chạy đầy đủ các chức năng khác.
async function tryBootstrapMemoryCoreAdmin(endpoint: string, apiKey: string, serviceId: string): Promise<boolean> {
  const attempts = 5
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
      // Gap thật phát hiện qua log Docker thật (không phải giả thuyết từ
      // đọc source suông): thiếu header `x-tdai-service-id` → 400
      // "missing_instance_id". Đọc thẳng memory-db/MemoryCore/src/metadata/
      // router/instance.ts xác nhận route này resolve instance_id TỪ HEADER
      // này (không phải field body `instance_id`) — cùng giá trị serviceId
      // dùng làm header x-tdai-service-id ở mọi call khác qua SDK.
      const res = await fetch(`${endpoint}/v3/internal/meta/user/init-admin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tdai-service-id': serviceId },
        body: JSON.stringify({ username: 'agent-core', user_key: apiKey }),
        signal: controller.signal,
      })
      if (res.ok || res.status === 409) return true
      console.error(`memory-core init-admin trả về status ${res.status} (lần ${attempt + 1}/${attempts}), thử lại...`)
    } catch (err) {
      console.error(
        `memory-core init-admin lần ${attempt + 1}/${attempts} lỗi: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      clearTimeout(timeout)
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
  }
  return false
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
  // Cordis fiber, KHÔNG làm process.exit(): agent-runner/api-rest/api-grpc
  // (api-rest giờ gánh cả WS upgrade từ Phase 6.3, không còn bundle api-ws
  // riêng) chỉ đứng yên ở PENDING mãi mãi (đã verify: fiber.await() không
  // đợi fiber còn PENDING), trong khi log dưới đây vẫn in ra như đã chạy
  // thành công — silent failure thật, không phải giả thuyết. Bắt buộc ở
  // đây để fail nhanh, ồn ào, đúng lúc boot — không dựa một mình vào
  // validate bên trong provider.
  const openaiBaseUrl = requireEnv('OPENAI_BASE_URL')
  const openaiModelId = requireEnv('OPENAI_MODEL_ID')
  // Module auth (nhiều người dùng thật): API_KEYS dùng chung đã bị THAY THẾ
  // hoàn toàn bằng tài khoản Postgres (đăng ký/đăng nhập, xem bundles/
  // providers/auth-users) — không còn env var nào cần thiết lập trước cho
  // auth, tài khoản tạo qua POST /auth/signup lúc chạy. Merge RLM harness:
  // `auth-apikey`/`API_KEYS` bị XOÁ HẲN (xem
  // docs/agent-core-rlm-harness-merge-plan.md mục 4.2) — nhánh RLM rẽ ra
  // trước khi module auth Postgres tồn tại nên chưa từng biết auth-users.
  const databaseUrl = requireEnv('DATABASE_URL')
  // Parse một lần tại composition root rồi truyền cùng một giá trị chuẩn
  // cho host LLM và Docker/RLM worker.
  const openaiExtraBody = optionalJsonObject('OPENAI_EXTRA_BODY')

  const root = new Context()
  // Phase 30: python/rlm_agent + vendor/rlm dời từ python/ ở root repo vào
  // đúng bundle sở hữu nó (bundles/loop-drivers/loop-rlm/python/) — chuẩn
  // cấu trúc plugin (docs/plugin-standard-structure.md: logic Python của 1
  // plugin nằm NGAY TRONG thư mục bundle đó, không tách rời ra ngoài).
  // worker.py vốn đã ở đúng chỗ này từ trước; giờ rlmWorkerPath/rlmRuntimeRoot
  // trỏ CHUNG 1 thư mục.
  const rlmBundlePythonRoot = path.join(agentCoreRoot, 'bundles', 'loop-drivers', 'loop-rlm', 'python')
  const rlmRuntimeRoot = path.resolve(process.env.RLM_RUNTIME_ROOT ?? rlmBundlePythonRoot)
  const workspaceBase = path.resolve(process.env.RLM_WORKSPACE_BASE ?? path.join(agentCoreRoot, 'data', 'rlm-workspaces'))
  const rlmWorkerPath = path.join(rlmBundlePythonRoot, 'worker.py')
  const rlmSandboxProvider = process.env.RLM_SANDBOX_PROVIDER ?? 'local'

  // Gap thật phát hiện lúc verify E2E tính năng Serper (không phải giả
  // thuyết): Cordis đánh số level NGƯỢC trực giác thường gặp — SỐ CÀNG CAO
  // càng verbose (error=0, info=1, warn=2, debug=3; xem node_modules/
  // @deepseek-ai/cordis/lib/index.js Logger._method — export message bị
  // BỎ QUA nếu `configuredLevel < messageLevel`). Mặc định cũ `LOG_LEVEL ?? 1`
  // vô tình ẩn TOÀN BỘ `.warn()` trong cả repo (auth-users/plugin-config-
  // postgres retry warning, tool-web-search fallback warning...) — verify
  // trực tiếp: thêm log tạm ở tool-web-search, `.info()` hiện ra nhưng
  // `.warn()` bên cạnh nó (cùng chỗ, cùng lúc) hoàn toàn im lặng cho tới khi
  // đổi default này lên 2. Không phải bug riêng của Serper — sửa 1 lần ở
  // đây cho đúng ý định BAN ĐẦU của mọi `.warn()` đã viết trong dự án
  // (cảnh báo vận hành cần thấy được, không phải noise nên ẩn).
  const exporter = {
    levels: { default: Number(process.env.LOG_LEVEL ?? 2) },
    export: (message: Parameters<typeof Logger.format>[1]) => {
      const line = `[${message.name}] ${Logger.format(exporter, message)}`
      if (message.type === 'error') console.error(line)
      else console.log(line)
    },
  }
  root.logger.exporter(exporter)

  // ctx.pluginInventory (docs: xem seams/plugin-inventory.ts) — ghi lại
  // tên/category/fiber của MỌI bundle mount qua `mount(...)` bên dưới thay
  // vì `root.plugin(...)` trực tiếp, để có 1 danh sách CHÍNH XÁC những gì
  // thật sự chạy (không đoán qua tên class/hàm nội bộ). `mounted` truyền
  // THẲNG (không copy) vào provider plugin-inventory ngay dưới đây — các
  // lệnh `mount(...)` GỌI SAU đó (kể cả 4 adapter cuối file) vẫn được ghi
  // nhận đúng vì list() luôn đọc lại đúng mảng gốc này lúc có request, mount
  // plugin-inventory không cần đứng cuối cùng.
  type PluginCategory = 'provider' | 'tool' | 'skill' | 'loop-driver' | 'prompt' | 'adapter' | 'pipeline-stage' | 'pipeline' | 'external'
  interface MountRecord {
    readonly name: string
    readonly category: PluginCategory
    readonly fiber: { readonly state: number }
  }
  const mounted: MountRecord[] = []
  function mount(name: string, category: PluginCategory, plugin: Parameters<Context['plugin']>[0], config?: unknown) {
    const fiber = root.plugin(plugin, config as never)
    mounted.push({ name, category, fiber })
    return fiber
  }

  mount('plugin-inventory', 'provider', pluginInventory, mounted)

  mount('tool-registry', 'provider', toolRegistry)
  mount('state-sqlite', 'provider', stateSqlite, {
    path: process.env.STORAGE_PATH ?? 'data/sessions.db',
    // Phase 8.4: KHÔNG set STORAGE_RETENTION_DAYS = không prune gì (mặc
    // định, backward compatible) — xem bundles/providers/state-sqlite.
    retentionDays: optionalNumber('STORAGE_RETENTION_DAYS'),
    retentionSweepIntervalMs: optionalNumber('STORAGE_RETENTION_SWEEP_INTERVAL_MS'),
  })
  // deny-by-default — chỉ mở đúng action tool-web-search cần
  // (actor "web-search", action "search"); tool nào khác cần permission
  // trong tương lai phải tự thêm rule riêng, không "mở hết" cho tiện.
  // "admin" (role, không phải actor tool) -> action 'admin:users:manage':
  // gate cho GET/PATCH/DELETE /users trong api-rest — tái dùng nguyên seam
  // RBAC đã có, không cần seam mới cho việc phân quyền admin. Cùng role
  // 'admin' -> thêm 'admin:plugins:view' cho GET /plugins (ctx.pluginInventory),
  // 'admin:plugins:configure' cho GET/PUT/DELETE /plugin-settings (ctx.pluginConfig)
  // — tách riêng action view vs configure dù cùng role, để sau này có thể
  // cấp lẻ (vd. 1 role chỉ xem, không sửa được secret).
  mount('permission-rbac', 'provider', permissionRbac, {
    rules: { 'web-search': ['search'], admin: ['admin:users:manage', 'admin:plugins:view', 'admin:plugins:configure', 'admin:skills:manage'] },
  })
  mount('llm-qwen', 'provider', llmQwen, {
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
    extraBody: openaiExtraBody,
    // Phase 8.3: retry cho lỗi transient (network/429/5xx) — không retry
    // 4xx khác (auth/request sai, fail y hệt lần nữa).
    maxRetries: optionalNumber('OPENAI_MAX_RETRIES'),
    retryBaseDelayMs: optionalNumber('OPENAI_RETRY_BASE_DELAY_MS'),
  })
  mount('context-compactor-llm', 'provider', contextCompactorLlm, {
    contextLimitTokens: optionalNumber('DEFAULT_MODEL_CONTEXT_TOKENS')
      ?? optionalNumber('RLM_MODEL_CONTEXT_TOKENS')
      ?? 30_000,
    thresholdPct: optionalNumber('DEFAULT_COMPACTION_THRESHOLD_PCT')
      ?? optionalNumber('RLM_COMPACTION_THRESHOLD_PCT')
      ?? 0.8,
  })
  mount('subagent-manager', 'provider', subagentManager)
  mount('skill-registry', 'provider', skillRegistry)
  mount('skill-selection-llm', 'provider', skillSelectionLlm)
  mount('skill-support-tone', 'skill', skillSupportTone)
  mount('skill-filesystem', 'provider', skillFilesystem, {
    root: process.env.RLM_SKILLS_ROOT ?? path.join(agentCoreRoot, 'bundles', 'skills'),
  })
  mount('prompt-registry', 'provider', promptRegistry)
  mount('prompt-default-agent', 'prompt', promptDefaultAgent)
  mount('prompt-rlm-data-agent', 'prompt', promptRlmDataAgent)
  // Fixed wording still degraded DS (3 FAIL in ds suite, timeout). Keep disabled;
  // the phase discipline is already covered by G1's evidence-policy <Understand>
  // line + repl-protocol 1-sentence plan. Enable via skill when needed.
  // root.plugin(promptDeepanalyzePhases)
  mount('memory-rolling', 'provider', memoryRolling, {
    basePath: process.env.RLM_MEMORY_PATH ?? path.join(agentCoreRoot, 'data', 'rlm-memory'),
  })
  if (rlmSandboxProvider === 'local') {
    mount('workspace-local', 'provider', workspaceLocal, { basePath: workspaceBase })
  } else {
    mount('workspace-docker', 'provider', workspaceDocker, {
      volumePrefix: process.env.RLM_DOCKER_VOLUME_PREFIX ?? 'agent-core-rlm-workspace',
    })
  }
  mount('artifact-service', 'provider', artifactService)
  mount('job-runner', 'provider', jobRunner, { maxConcurrent: optionalNumber('JOB_MAX_CONCURRENT') })
  mount('pipeline-registry', 'provider', pipelineRegistry)
  mount('loop-registry', 'provider', loopRegistry)
  mount('loop-default', 'loop-driver', loopDefault)
  mount('loop-rlm', 'loop-driver', loopRlm)
  // Muốn hot-swap sang loop-planner-critic khi đang chạy: KHÔNG mount cả 2
  // cùng lúc (cùng đăng ký tên 'default', mount lần 2 sẽ throw "already
  // registered") — dispose fiber loop-default trước, đúng pattern
  // tests/chaos-hot-swap.test.ts.
  mount('agent-runner', 'provider', agentRunner)
  mount('session-registry', 'provider', sessionRegistry, {
    // Phase 8.1: TTL trượt theo hoạt động — xem bundles/providers/session-registry.
    ttlMs: optionalNumber('SESSION_TTL_MS'),
    sweepIntervalMs: optionalNumber('SESSION_SWEEP_INTERVAL_MS'),
  })
  mount('project-registry', 'provider', projectRegistry)
  mount('auth-users', 'provider', authUsers, { connectionString: databaseUrl })
  // ctx.pluginConfig — cấu hình plugin admin đổi được qua UI (không cần
  // restart), vd. serperApiKey cho tool-web-search. Cùng DATABASE_URL đã
  // bắt buộc cho ctx.auth, không thêm biến môi trường bắt buộc mới.
  mount('plugin-config-postgres', 'provider', pluginConfigPostgres, { connectionString: databaseUrl })
  // ctx.customSkills — skill riêng do user tự thêm qua UI (nút "Kỹ năng"),
  // Postgres (cùng DATABASE_URL), warm vào ctx.skills lúc boot + đồng bộ
  // ngay mỗi lần CRUD, không cần restart. Xem docs/agent-core-user-custom-skill-plan.md.
  mount('custom-skill-store-postgres', 'provider', customSkillStorePostgres, { connectionString: databaseUrl })

  // Module memory (ctx.memory, TÙY CHỌN) — xem chú thích tại
  // tryBootstrapMemoryCoreAdmin ở trên. Không set MEMORY_CORE_API_KEY = bỏ
  // qua hoàn toàn, ctx.memory không mount, hệ thống chạy y hệt trước đây.
  //
  // Bug thật phát hiện lúc deploy VPS (2026-08): trước đây feature-detect
  // dựa trên `MEMORY_CORE_URL` — nhưng docker-compose.yml's `environment:`
  // luôn TỰ ĐIỀN default `http://memory-core:8420` cho biến này (kể cả khi
  // `.env` không set gì), nên `memoryCoreUrl` LUÔN truthy trong container
  // Docker, khiến FATAL check ngay dưới đây bắn sai cho MỌI deploy fresh
  // không cấu hình memory (không phải lỗi riêng của 1 user). Sửa: dùng
  // `MEMORY_CORE_API_KEY` làm tín hiệu BẬT/TẮT chính — biến này KHÔNG có
  // default nào ở compose (`${MEMORY_CORE_API_KEY:-}`, rỗng nếu không set),
  // nên "không set" luôn đúng nghĩa "không set" thật. `memoryCoreUrl` tự
  // default về địa chỉ container `memory-core` trong compose CHỈ KHI đã có
  // API key (đúng tinh thần "chỉ cần set 1 biến cho Docker" mà .env.example
  // hứa, không còn đụng docker-compose.yml nữa vì Compose không hỗ trợ
  // default có điều kiện theo biến khác).
  const memoryCoreApiKey = process.env.MEMORY_CORE_API_KEY
  const memoryCoreUrl = process.env.MEMORY_CORE_URL || (memoryCoreApiKey ? 'http://memory-core:8420' : undefined)
  if (memoryCoreUrl && !memoryCoreApiKey) {
    console.error('FATAL: MEMORY_CORE_URL được set nhưng thiếu MEMORY_CORE_API_KEY — set cả 2 hoặc bỏ trống cả 2.')
    process.exit(1)
  }
  if (memoryCoreUrl && memoryCoreApiKey) {
    const memoryCoreServiceId = process.env.MEMORY_CORE_SERVICE_ID ?? 'default'
    const bootstrapped = await tryBootstrapMemoryCoreAdmin(memoryCoreUrl, memoryCoreApiKey, memoryCoreServiceId)
    if (bootstrapped) {
      mount('memory-tencentdb', 'provider', memoryTencentdb, {
        endpoint: memoryCoreUrl,
        apiKey: memoryCoreApiKey,
        serviceId: memoryCoreServiceId,
      })
    } else {
      console.error(
        'CẢNH BÁO: không bootstrap được memory-core sau nhiều lần thử — ctx.memory KHÔNG mount, agent-core vẫn chạy bình thường (không có tính năng ghi nhớ).',
      )
    }
  } else {
    console.log('MEMORY_CORE_URL không được set — bỏ qua module memory (ctx.memory không mount, tuỳ chọn).')
  }

  // RLM harness (ctx.turnMemory đã mount qua memoryRolling ở trên, TÁCH
  // KHỎI ctx.memory — xem docs/agent-core-rlm-harness-merge-plan.md mục
  // 4.1): sandbox process bridge cho loop-rlm.
  const rlmAgentConfig = {
    // Model calls được worker bridge ngược về ctx.llm; không đưa API key vào
    // environment/argv của container RLM.
    api_key: 'host-llm-bridge',
    base_url_programmer: '',
    programmer_model: openaiModelId,
    rlm: {
      environment: process.env.RLM_ENVIRONMENT ?? 'ipython',
      kernel_mode: process.env.RLM_KERNEL_MODE ?? 'subprocess',
      max_iterations: optionalNumber('RLM_MAX_ITERATIONS') ?? 8,
      max_depth: optionalNumber('RLM_MAX_DEPTH') ?? 1,
      max_timeout: optionalNumber('RLM_MAX_TIMEOUT') ?? 300,
      cell_timeout: optionalNumber('RLM_CELL_TIMEOUT') ?? 300,
      max_errors: optionalNumber('RLM_MAX_ERRORS') ?? 5,
      max_concurrent_subcalls: optionalNumber('RLM_MAX_CONCURRENT_SUBCALLS') ?? 4,
      compaction_threshold_pct: optionalNumber('RLM_COMPACTION_THRESHOLD_PCT') ?? 0.8,
      model_context_tokens: optionalNumber('RLM_MODEL_CONTEXT_TOKENS') ?? 30_000,
      max_output_tokens: optionalNumber('RLM_MAX_OUTPUT_TOKENS') ?? 2_048,
      sub_max_output_tokens: optionalNumber('RLM_SUB_MAX_OUTPUT_TOKENS') ?? 4_096,
      memory_max_output_tokens: optionalNumber('RLM_MEMORY_MAX_OUTPUT_TOKENS') ?? 1_200,
    },
  }
  if (rlmSandboxProvider === 'local') {
    mount('sandbox-ipython', 'provider', sandboxIpython, {
      pythonBin: process.env.RLM_PYTHON_BIN,
      workerPath: rlmWorkerPath,
      runtimeRoot: rlmRuntimeRoot,
      agentConfig: rlmAgentConfig,
    })
  } else {
    mount('sandbox-docker', 'provider', sandboxDocker, {
      dockerBin: process.env.RLM_DOCKER_BIN,
      image: process.env.RLM_DOCKER_IMAGE ?? 'agent-core:latest',
      agentConfig: rlmAgentConfig,
      networkDisabled: optionalBoolean('RLM_DOCKER_NETWORK_DISABLED') ?? true,
      memory: process.env.RLM_DOCKER_MEMORY,
      cpus: optionalNumber('RLM_DOCKER_CPUS'),
      pidsLimit: optionalNumber('RLM_DOCKER_PIDS_LIMIT'),
      // Project workspaces are shared by multiple chat sessions and survive
      // worker restarts. Destruction must be an explicit project lifecycle action.
      removeWorkspaceVolumeOnClose: optionalBoolean('RLM_DOCKER_REMOVE_VOLUME_ON_CLOSE') ?? false,
      extraBody: openaiExtraBody ? JSON.stringify(openaiExtraBody) : undefined,
    })
  }
  mount('stage-data-load', 'pipeline-stage', stageDataLoad)
  mount('stage-feature-basic', 'pipeline-stage', stageFeatureBasic)
  mount('stage-train-majority', 'pipeline-stage', stageTrainMajority)
  mount('stage-train-flaml', 'pipeline-stage', stageTrainFlaml)
  mount('stage-validate-holdout', 'pipeline-stage', stageValidateHoldout)
  mount('stage-report-markdown', 'pipeline-stage', stageReportMarkdown)
  mount('pipeline-tabular-classification', 'pipeline', pipelineTabularClassification)
  mount('pipeline-runner', 'provider', pipelineRunner)
  mount('tool-database-query', 'tool', toolDatabaseQuery)
  mount('tool-web-search', 'tool', toolWebSearch, {
    // Audit fix: trước đây không có timeout, fetch() có thể treo cả turn vô
    // thời hạn nếu DuckDuckGo không phản hồi — xem bundles/tools/tool-web-search.
    timeoutMs: optionalNumber('WEB_SEARCH_TIMEOUT_MS'),
    // 2026-08: Serper.dev làm provider CHÍNH (chất lượng cao hơn hẳn scrape
    // HTML), DuckDuckGo tự động dự phòng khi Serper lỗi/hết hạn mức — xem
    // chú thích đầy đủ tại bundles/tools/tool-web-search/index.ts. Không set
    // SERPER_API_KEY = bỏ qua Serper hoàn toàn, chạy y hệt trước đây.
    serperApiKey: process.env.SERPER_API_KEY,
  })
  mount('tool-skill', 'tool', toolSkill)

  // EXTRA_PLUGINS (docs/agent-core-adding-plugins.md) — plugin bên thứ ba,
  // KHÔNG cần sửa file này. Nạp SAU mọi seam nội bộ (author có thể `inject`
  // bất kỳ seam nào ở trên, dù thứ tự mount thực ra không bắt buộc — Cordis
  // tự chờ dependency qua `inject`). Fail loudly (đúng triết lý requireEnv)
  // nếu format sai, JSON config sai, hoặc module không export đúng contract
  // plugin — không âm thầm bỏ qua 1 plugin lẽ ra phải chạy.
  let extraPluginEntries: ReturnType<typeof parseExtraPlugins>
  try {
    extraPluginEntries = parseExtraPlugins(process.env.EXTRA_PLUGINS, agentCoreRoot)
  } catch (err: any) {
    console.error(`FATAL: ${err.message}`)
    process.exit(1)
  }
  for (const { name, specifier } of extraPluginEntries) {
    let config: unknown
    try {
      config = extraPluginConfig(process.env[`EXTRA_PLUGIN_CONFIG__${name}`])
    } catch (err: any) {
      console.error(`FATAL: env var EXTRA_PLUGIN_CONFIG__${name} phải là JSON hợp lệ — lỗi parse: ${err.message}`)
      process.exit(1)
    }
    const mod: unknown = await import(specifier)
    if (!isPluginModule(mod)) {
      console.error(`FATAL: EXTRA_PLUGINS "${name}" (${specifier}) không export "apply" hoặc default hợp lệ.`)
      process.exit(1)
    }
    mount(name, 'external', mod as Parameters<Context['plugin']>[0], config)
    console.log(`[extra-plugin] mounted "${name}" từ "${specifier}"`)
  }

  // Phase 6.3: WS dùng CHUNG port với REST (bundle api-ws cũ đã gộp vào
  // api-rest — xem bundles/adapters/api-rest) — không còn PORT_WS riêng.
  const restConfig = { port: Number(process.env.PORT_REST ?? 8787) }
  const grpcConfig = { port: Number(process.env.PORT_GRPC ?? 50051) }
  const webUiConfig = { port: Number(process.env.PORT_WEB_UI ?? 8790) }
  await mount('api-rest', 'adapter', apiRest, restConfig)
  await mount('api-grpc', 'adapter', apiGrpc, grpcConfig)
  await mount('web-ui', 'adapter', webUi, webUiConfig)

  console.log(`\nWeb UI  http://localhost:${webUiConfig.port}  (đăng nhập/đăng ký ngay lần mở đầu tiên)`)
  console.log(`REST    http://localhost:${restConfig.port}  (Authorization: Bearer <token> từ POST /auth/login hoặc /auth/signup, trừ /health /ready /auth/signup /auth/login)`)
  console.log(`WS      ws://localhost:${restConfig.port}/sessions/:id/events/stream  (?token=<token>, downlink-only: step/done/error)`)
  console.log(`gRPC    localhost:${grpcConfig.port}  (metadata "authorization")\n`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      console.log(`\n${signal} — shutting down...`)
      await root.agent.drain(optionalNumber('SHUTDOWN_DRAIN_MS') ?? 10_000)
      await root.fiber.dispose()
      process.exit(0)
    })
  }
}

main().catch((err) => {
  console.error('FATAL during boot:', err)
  process.exit(1)
})
