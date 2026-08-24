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
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context, Logger } from '@deepseek-ai/cordis'
import { parseJsonObjectEnv } from './env.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as llmQwen from '../bundles/providers/llm-qwen/index.ts'
import * as subagentManager from '../bundles/providers/subagent-manager/index.ts'
import * as skillRegistry from '../bundles/providers/skill-registry/index.ts'
import * as skillFilesystem from '../bundles/providers/skill-filesystem/index.ts'
import * as promptRegistry from '../bundles/providers/prompt-registry/index.ts'
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
import * as sessionRegistry from '../bundles/providers/session-registry/index.ts'
import * as authApiKey from '../bundles/providers/auth-apikey/index.ts'
import * as apiRest from '../bundles/adapters/api-rest/index.ts'
import * as apiWs from '../bundles/adapters/api-ws/index.ts'
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
  // Parse một lần tại composition root rồi truyền cùng một giá trị chuẩn
  // cho host LLM và Docker worker.
  const openaiExtraBody = optionalJsonObject('OPENAI_EXTRA_BODY')
  const apiKeys = requireEnv('API_KEYS')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (!apiKeys.length) {
    console.error('FATAL: API_KEYS rỗng sau khi parse — cần ít nhất 1 key hợp lệ.')
    process.exit(1)
  }

  const root = new Context()
  const rlmRuntimeRoot = path.resolve(process.env.RLM_RUNTIME_ROOT ?? path.join(agentCoreRoot, 'python'))
  const workspaceBase = path.resolve(process.env.RLM_WORKSPACE_BASE ?? path.join(agentCoreRoot, 'data', 'rlm-workspaces'))
  const rlmWorkerPath = path.join(agentCoreRoot, 'bundles', 'loop-drivers', 'loop-rlm', 'python', 'worker.py')
  const rlmSandboxProvider = process.env.RLM_SANDBOX_PROVIDER ?? 'local'

  const exporter = {
    levels: { default: Number(process.env.LOG_LEVEL ?? 1) },
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
    extraBody: openaiExtraBody,
    // Phase 8.3: retry cho lỗi transient (network/429/5xx) — không retry
    // 4xx khác (auth/request sai, fail y hệt lần nữa).
    maxRetries: optionalNumber('OPENAI_MAX_RETRIES'),
    retryBaseDelayMs: optionalNumber('OPENAI_RETRY_BASE_DELAY_MS'),
  })
  root.plugin(subagentManager)
  root.plugin(skillRegistry)
  root.plugin(skillSupportTone)
  root.plugin(skillFilesystem, {
    root: process.env.RLM_SKILLS_ROOT ?? path.join(agentCoreRoot, 'bundles', 'skills'),
  })
  root.plugin(promptRegistry)
  root.plugin(promptRlmDataAgent)
  // Fixed wording still degraded DS (3 FAIL in ds suite, timeout). Keep disabled;
  // the phase discipline is already covered by G1's evidence-policy <Understand>
  // line + repl-protocol 1-sentence plan. Enable via skill when needed.
  // root.plugin(promptDeepanalyzePhases)
  root.plugin(memoryRolling, {
    basePath: process.env.RLM_MEMORY_PATH ?? path.join(agentCoreRoot, 'data', 'rlm-memory'),
  })
  if (rlmSandboxProvider === 'local') {
    root.plugin(workspaceLocal, { basePath: workspaceBase })
  } else {
    root.plugin(workspaceDocker, {
      volumePrefix: process.env.RLM_DOCKER_VOLUME_PREFIX ?? 'agent-core-rlm-workspace',
    })
  }
  root.plugin(artifactService)
  root.plugin(jobRunner, { maxConcurrent: optionalNumber('JOB_MAX_CONCURRENT') })
  root.plugin(pipelineRegistry)
  root.plugin(loopRegistry)
  root.plugin(loopDefault)
  root.plugin(loopRlm)
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
    root.plugin(sandboxIpython, {
      pythonBin: process.env.RLM_PYTHON_BIN,
      workerPath: rlmWorkerPath,
      runtimeRoot: rlmRuntimeRoot,
      agentConfig: rlmAgentConfig,
    })
  } else {
    root.plugin(sandboxDocker, {
      dockerBin: process.env.RLM_DOCKER_BIN,
      image: process.env.RLM_DOCKER_IMAGE ?? 'agent-core:latest',
      agentConfig: rlmAgentConfig,
      networkDisabled: optionalBoolean('RLM_DOCKER_NETWORK_DISABLED') ?? true,
      memory: process.env.RLM_DOCKER_MEMORY,
      cpus: optionalNumber('RLM_DOCKER_CPUS'),
      pidsLimit: optionalNumber('RLM_DOCKER_PIDS_LIMIT'),
      removeWorkspaceVolumeOnClose: optionalBoolean('RLM_DOCKER_REMOVE_VOLUME_ON_CLOSE') ?? true,
      extraBody: openaiExtraBody ? JSON.stringify(openaiExtraBody) : undefined,
    })
  }
  root.plugin(stageDataLoad)
  root.plugin(stageFeatureBasic)
  root.plugin(stageTrainMajority)
  root.plugin(stageTrainFlaml)
  root.plugin(stageValidateHoldout)
  root.plugin(stageReportMarkdown)
  root.plugin(pipelineTabularClassification)
  root.plugin(pipelineRunner)
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
