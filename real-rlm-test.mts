// Tester loop-rlm THẬT: worker Python thật (system python3) + LLM thật qua proxy.
// Quota: giữ max_iterations thấp. Chạy: timeout 590 npx tsx real-rlm-test.mts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from './bundles/providers/tool-registry/index.ts'
import * as skillRegistry from './bundles/providers/skill-registry/index.ts'
import * as stateSqlite from './bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from './bundles/providers/loop-registry/index.ts'
import * as loopRlm from './bundles/loop-drivers/loop-rlm/index.ts'
import * as agentRunner from './bundles/providers/agent-runner/index.ts'
import * as sessionRegistry from './bundles/providers/session-registry/index.ts'
import * as promptRegistry from './bundles/providers/prompt-registry/index.ts'
import * as promptRlmDataAgent from './bundles/prompts/prompt-rlm-data-agent/index.ts'
import * as contextCompactorLlm from './bundles/providers/context-compactor-llm/index.ts'
import * as memoryRolling from './bundles/providers/memory-rolling/index.ts'
import * as workspaceLocal from './bundles/providers/workspace-local/index.ts'
import * as sandboxIpython from './bundles/providers/sandbox-ipython/index.ts'
import * as llmQwen from './bundles/providers/llm-qwen/index.ts'
import * as toolDatabaseQuery from './bundles/tools/tool-database-query/index.ts'
import { Session } from './seams/loop.ts'

const log: string[] = []
function fb(tag: string, msg: string) {
  const line = `[${tag}] ${msg}`
  log.push(line)
  console.log(line)
}

async function main() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'real-rlm-'))
  const wsBase = path.join(base, 'ws')
  mkdirSync(wsBase, { recursive: true })
  const SESSION_ID = 'real-rlm-1'
  // workspace của session = wsBase/<sessionId> (workspaceId mặc định = session id).
  // Ghi qua fs trực tiếp vào đúng thư mục đó (mô phỏng file user upload sẵn).
  const sessDir = path.join(wsBase, SESSION_ID)
  mkdirSync(sessDir, { recursive: true })
  writeFileSync(path.join(sessDir, 'sales.csv'), 'month,revenue,region\n1,100,HN\n2,150,HCM\n3,130,HN\n4,170,HCM\n')

  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry)
  root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(llmQwen)
  root.plugin(contextCompactorLlm)
  root.plugin(memoryRolling, { basePath: path.join(base, 'mem') })
  root.plugin(workspaceLocal, { basePath: wsBase })
  root.plugin(toolDatabaseQuery)
  root.plugin(sandboxIpython, {
    pythonBin: 'python3',
    workerPath: '/app/bundles/loop-drivers/loop-rlm/python/worker.py',
    runtimeRoot: '/app/bundles/loop-drivers/loop-rlm/python',
    agentConfig: {
      api_key: 'host-llm-bridge',
      base_url_programmer: '',
      programmer_model: process.env.OPENAI_MODEL_ID,
      rlm: {
        environment: 'ipython', kernel_mode: 'subprocess',
        max_iterations: 3, max_depth: 1, max_timeout: 240, cell_timeout: 120,
        max_errors: 3, max_concurrent_subcalls: 2,
        model_context_tokens: 30000, max_output_tokens: 2048,
      },
    },
  })
  root.plugin(loopRegistry); root.plugin(loopRlm); root.plugin(agentRunner)
  root.plugin(sessionRegistry)
  await new Promise((r) => setTimeout(r, 3000))

  const s = new Session(SESSION_ID, 25, undefined, 'rlm')
  const steps: string[] = []
  root.on('agent/step', ({ step }) => {
    steps.push(step.type)
    if (['analysis', 'code', 'observation', 'error', 'final', 'tool_call', 'tool_result'].includes(step.type)) {
      console.log(`  [step:${step.type}]`, JSON.stringify(step).slice(0, 300))
    }
  })
  const t0 = Date.now()
  try {
    const r = await root.agent.runTurn('rlm', s, 'File sales.csv có các cột gì, tổng revenue bao nhiêu? Trả lời ngắn gọn.')
    fb('INFO', `turn xong ${(Date.now() - t0) / 1000}s status=${r.status} steps=${r.steps}`)
    console.log('ANSWER:', String(r.content).slice(0, 1000))
  } catch (e: any) {
    fb('THROW', `turn 1 fail: ${String(e.message).slice(0, 300)}`)
  }
  // Turn 2: hỏi nối tiếp — kiểm tra session memory (turn 1 đã thấy file gì?)
  const t1 = Date.now()
  try {
    const r2 = await root.agent.runTurn('rlm', s, 'Thế region nào revenue cao nhất? Chỉ nêu tên region và con số.')
    fb('INFO', `turn 2 xong ${(Date.now() - t1) / 1000}s status=${r2.status} steps=${r2.steps}`)
    console.log('ANSWER2:', String(r2.content).slice(0, 600))
  } catch (e: any) {
    fb('THROW', `turn 2 fail: ${String(e.message).slice(0, 300)}`)
  }
  const counts: Record<string, number> = {}
  for (const t of steps) counts[t] = (counts[t] ?? 0) + 1
  fb('INFO', `step histogram: ${JSON.stringify(counts)}`)
  const evs = await root.storage.readEvents(s.id)
  fb('INFO', `storage events=${evs.length}: ${JSON.stringify([...new Set(evs.map((e) => e.type))])}`)
  const errs = evs.filter((e) => e.type === 'error')
  for (const e of errs) fb('ERROR-EVENT', JSON.stringify(e).slice(0, 300))

  await root.fiber.dispose()
  rmSync(base, { recursive: true, force: true })
  console.log('\n==== FEEDBACK ====')
  for (const l of log) console.log(l)
  process.exit(0)
}
main().catch((e) => { console.error('CRASH:', e); process.exit(1) })
