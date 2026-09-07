// Stress loop-rlm THẬT: 18 turn đa chủ đề + file + lỗi + edge + memory.
// Chạy nền: nohup npx tsx real-rlm-heavy.mts > /tmp/opencode/rlm-heavy.log 2>&1 &
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log: string[] = []
function fb(tag: string, msg: string) {
  const line = `[${tag}] ${msg}`
  log.push(line)
  console.log(line)
}

async function main() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'real-rlm-heavy-'))
  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry)
  root.plugin(promptRegistry); root.plugin(promptRlmDataAgent)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(llmQwen)
  root.plugin(contextCompactorLlm)
  root.plugin(memoryRolling, { basePath: path.join(base, 'mem') })
  root.plugin(workspaceLocal, { basePath: path.join(base, 'ws') })
  root.plugin(toolDatabaseQuery)
  root.plugin(sandboxIpython, {
    pythonBin: 'python3',
    workerPath: '/app/bundles/loop-drivers/loop-rlm/python/worker.py',
    runtimeRoot: '/app/bundles/loop-drivers/loop-rlm/python',
    agentConfig: {
      api_key: 'host-llm-bridge', base_url_programmer: '',
      programmer_model: process.env.OPENAI_MODEL_ID,
      rlm: {
        environment: 'ipython', kernel_mode: 'subprocess',
        max_iterations: 4, max_depth: 1, max_timeout: 240, cell_timeout: 120,
        max_errors: 3, max_concurrent_subcalls: 2,
        model_context_tokens: 30000, max_output_tokens: 2048,
      },
    },
  })
  root.plugin(loopRegistry); root.plugin(loopRlm); root.plugin(agentRunner)
  root.plugin(sessionRegistry)
  await sleep(3000)

  const SID = 'heavy-rlm-1'
  const s = new Session(SID, 25, undefined, 'rlm')
  // File 1 có sẵn từ đầu (qua service -> indexed)
  await root.workspace.writeFile(SID, 'sales.csv', Buffer.from('month,revenue,region\n1,100,HN\n2,150,HCM\n3,130,HN\n4,170,HCM\n5,200,HN\n6,190,HCM\n'))

  const turns: Array<[string, string]> = [
    ['R1-columns', 'File sales.csv có những cột nào, bao nhiêu dòng? Trả lời ngắn gọn.'],
    ['R2-total', 'Tổng revenue và revenue trung bình mỗi tháng là bao nhiêu?'],
    ['R3-region', 'So sánh revenue HN vs HCM, region nào cao hơn?'],
    ['R4-anaphora', 'Còn tháng cao nhất trong cái file đó là tháng mấy?'],
    ['R5-newfile', 'Tôi vừa thêm file products.csv (gồm product,price). Liệt kê sản phẩm và giá giúp tôi.'],
    ['R6-missing', 'Đọc giúp tôi file khong_ton_tai.csv xem có gì.'],
    ['R7-divzero', 'Tính revenue trung bình chia cho 0 xem ra gì? Cứ thử code đi.'],
    ['R8-unicode', '😀 Dữ liệu bán hàng 6 tháng đầu năm nay có gì đáng chú ý? Nhận xét bằng tiếng Việt nhé!'],
    ['R9-empty', ''],
    ['R10-long', 'Phân tích chi tiết ' + 'doanh thu theo tháng và region, xu hướng tăng giảm, dự báo. '.repeat(60)],
    ['R11-offtopic', 'Thôi bỏ số liệu. Viết giúp tôi 1 đoạn văn ngắn giới thiệu Đà Nẵng cho tờ rơi du lịch.'],
    ['R12-back', 'Quay lại sales.csv: vẽ biểu đồ cột revenue theo tháng rồi mô tả xu hướng.'],
    ['R13-summary', 'Tóm tắt tất cả những gì mình đã làm từ đầu tới giờ.'],
    ['R14-memory', 'Kết luận lúc nãy region nào cao nhất và chênh bao nhiêu?'],
    ['R15-hard', 'Làm phân tích đầy đủ: tổng hợp theo region và tháng, tính tăng trưởng MoM từng tháng, tìm outlier, rồi kết luận 3 insight quan trọng nhất.'],
    ['R16-vietnamese-heavy', 'Cho hỏi dạo này tình hình kinh tế Đà Nẵng ra sao, có ảnh hưởng gì tới sức mua bán lẻ không bạn?'],
    ['R17-tool', 'Dùng tool query_database tra cứu phiên này rồi cho biết có bao nhiêu event đã ghi.'],
    ['R18-bye', 'Cảm ơn, tóm tắt 1 câu kết quả chính của cả buổi rồi chào tạm biệt.'],
  ]

  for (const [label, q] of turns) {
    // Giữa R4-R5: thêm file mới mô phỏng user upload giữa chừng
    if (label === 'R5-newfile') {
      await root.workspace.writeFile(SID, 'products.csv', Buffer.from('product,price\nCa phe,45000\nTra sua,35000\nBanh mi,20000\n'))
      console.log('  [setup] đã thêm products.csv giữa session')
    }
    const stepTypes: string[] = []
    const off = root.on('agent/step', ({ step }) => stepTypes.push(step.type))
    const t0 = Date.now()
    let attempt = 0
    while (true) {
      attempt++
      try {
        const r = await root.agent.runTurn('rlm', s, q)
        const dt = ((Date.now() - t0) / 1000).toFixed(1)
        const iters = stepTypes.filter((t) => t === 'iteration_completed').length
        const leaked = /```repl|answer\["content"\]|answer\['content'\]/.test(String(r.content))
        console.log(`\n### ${label} (${dt}s status=${r.status} iters=${iters}${leaked ? ' LEAK-REPL!' : ''})`)
        console.log(`Q: ${q.slice(0, 120)}`)
        console.log(`A: ${String(r.content).slice(0, 500)}${String(r.content).length > 500 ? '…' : ''}`)
        if (leaked) fb('LEAK', `${label}: final chứa cú pháp repl nội bộ`)
        if (String(r.content).includes('[tool_call:')) fb('LEAK', `${label}: final chứa nhãn tool_call`)
        break
      } catch (e: any) {
        const msg = String(e.message ?? e).slice(0, 120)
        if (/rate limit/i.test(msg) && attempt === 1) {
          console.log(`  [${label}] 429 -> chờ 70s thử lại 1 lần`)
          await sleep(70000)
          continue
        }
        fb('THROW', `${label}: ${msg}`)
        await sleep(15000)
        break
      }
    }
    off()
    await sleep(15000) // pace giữ quota
  }

  const evs = await root.storage.readEvents(SID)
  const counts: Record<string, number> = {}
  for (const e of evs) counts[e.type] = (counts[e.type] ?? 0) + 1
  fb('INFO', `tổng events=${evs.length} histogram=${JSON.stringify(counts)}`)
  const noProg = evs.filter((e) => e.type === 'final_answer' && String((e as any).content ?? '').includes('NO_PROGRESS'))
  fb('INFO', `final_answer dính NO_PROGRESS fallback: ${noProg.length}`)
  const emptyAnalysis = evs.filter((e) => e.type === 'analysis' && !String((e as any).content ?? '').trim()).length
  fb('INFO', `analysis rỗng: ${emptyAnalysis}`)
  const memUpd = evs.filter((e) => e.type === 'memory_updated').length
  fb('INFO', `memory_updated: ${memUpd}`)

  await root.fiber.dispose()
  rmSync(base, { recursive: true, force: true })
  console.log('\n==== FEEDBACK ====')
  for (const l of log) console.log(l)
  process.exit(0)
}
main().catch((e) => { console.error('CRASH:', e); process.exit(1) })
