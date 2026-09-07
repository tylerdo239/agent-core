import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from './bundles/providers/tool-registry/index.ts'
import * as skillRegistry from './bundles/providers/skill-registry/index.ts'
import * as stateSqlite from './bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from './bundles/providers/loop-registry/index.ts'
import * as loopDefault from './bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from './bundles/providers/agent-runner/index.ts'
import * as sessionRegistry from './bundles/providers/session-registry/index.ts'
import * as promptRegistry from './bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from './bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from './bundles/providers/context-compactor-llm/index.ts'
import * as skillSelectionLlm from './bundles/providers/skill-selection-llm/index.ts'
import * as llmQwen from './bundles/providers/llm-qwen/index.ts'
import * as toolSkill from './bundles/tools/tool-skill/index.ts'
import * as toolDatabaseQuery from './bundles/tools/tool-database-query/index.ts'
import * as workspaceLocal from './bundles/providers/workspace-local/index.ts'
import { MemoryService, MemoryEntry, MemoryContext } from './seams/memory.ts'
import { Session } from './seams/loop.ts'

const log: string[] = []
function fb(tag: string, msg: string) {
  const line = `[${tag}] ${msg}`
  log.push(line)
  console.log(line)
}

// FakeMemory: per-user store, recall chấm điểm overlap từ khóa.
class FakeMemory extends MemoryService {
  store = new Map<string, string[]>()
  key(sessionId: string, ctx?: MemoryContext) { return `${ctx?.userId ?? 'anon'}::${sessionId}` }
  async remember(sessionId: string, text: string, ctx?: MemoryContext): Promise<void> {
    const k = this.key(sessionId, ctx)
    this.store.set(k, [...(this.store.get(k) ?? []), text])
  }
  async recall(sessionId: string, query: string, limit = 3, ctx?: MemoryContext): Promise<MemoryEntry[]> {
    const k = this.key(sessionId, ctx)
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    const scored = (this.store.get(k) ?? []).map((text, i) => ({
      id: `${i}`, text,
      score: words.filter((w) => text.toLowerCase().includes(w)).length,
    }))
    return scored.filter((e) => e.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

async function ask(root: Context, session: Session, q: string, label: string) {
  const t0 = Date.now()
  const before = (await root.storage.readEvents(session.id)).length
  try {
    const r = await root.agent.runTurn('default', session, q)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    const fresh = (await root.storage.readEvents(session.id)).slice(before)
    const tools = fresh.filter((e) => e.type === 'model_message' && (e as any).toolCall).map((e: any) => e.toolCall.name)
    const sel = fresh.find((e) => (e as any).type === 'skill_selection') as any
    const memos = fresh.filter((e) => (e as any).type === 'model_message').length
    console.log(`\n### ${label} (${dt}s steps=${r.steps}${tools.length ? ` tools=[${tools.join(',')}]` : ''}${sel ? ` router=${sel.outcome}${sel.skill ? ':' + sel.skill : ''}` : ''})`)
    console.log(`Q: ${q.slice(0, 130)}`)
    console.log(`A: ${String(r.content).slice(0, 650)}${String(r.content).length > 650 ? '…' : ''}`)
    void memos
    return r
  } catch (e: any) {
    fb('THROW', `${label}: ${String(e.message).slice(0, 140)}`)
    return undefined
  } finally {
    await new Promise((r) => setTimeout(r, 7000))
  }
}

async function main() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'real-user2-'))
  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry)
  root.plugin(promptRegistry); root.plugin(promptDefaultAgent)
  root.plugin(contextCompactorLlm)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(llmQwen)
  root.plugin(skillSelectionLlm)
  root.plugin((ctx: Context) => { ctx.plugin(FakeMemory) })
  root.plugin(toolSkill); root.plugin(toolDatabaseQuery)
  root.plugin(workspaceLocal, { basePath: base })
  root.plugin(loopRegistry); root.plugin(loopDefault); root.plugin(agentRunner)
  root.plugin(sessionRegistry)
  await new Promise((r) => setTimeout(r, 2000))

  // Skill custom có resource + reader thật
  root.skills.register(
    { name: 'market-research', description: 'Nghiên cứu thị trường: quy mô, đối thủ, thị phần ngành viễn thông Việt Nam.', instructions: 'Luôn trích nguồn số liệu, so sánh tối thiểu 3 đối thủ, chốt bằng bảng tóm tắt.', triggers: ['thị trường', 'thị phần', 'đối thủ', 'nghiên cứu thị trường'], userInvocable: true },
    async (p) => {
      if (p === 'guides/method.md') return { content: '# Phương pháp NCTT\n1. Xác định quy mô\n2. Liệt kê đối thủ\n3. So sánh thị phần', encoding: 'utf-8' as const }
      throw new Error(`resource "${p}" not found`)
    },
  )
  // khai resources vào definition? registry giữ definition gốc — patch resources:
  const def = root.skills.get('market-research')!
  ;(def as any).resources = [{ path: 'guides/method.md' }]

  // ═══ Session MINH (owner user-minh): 20 câu, test memory + skill + tool + ngữ cảnh ═══
  const m = new Session('sess-minh', 25, undefined, 'default', 40, 'user-minh')
  const Q: Array<[string, string]> = [
    ['M1-ten', 'Chào bạn, tôi tên Minh, 32 tuổi, làm product manager ở một công ty fintech tại Hà Nội'],
    ['M2-du-an', 'Dự án hiện tại của tôi là ví điện tử tên FastPay, team 8 người, deadline tháng 12'],
    ['M3-thi-truong', 'Cho tôi nghiên cứu thị trường ví điện tử Việt Nam hiện nay: quy mô, đối thủ chính, thị phần'],
    ['M4-doc-resource', 'Đọc giúp tôi tài liệu phương pháp nghiên cứu trong skill vừa dùng'],
    ['M5-resource-sai', 'Đọc giúp tôi tài liệu guides/khong-ton-tai.md trong skill đó'],
    ['M6-seed-tra-cuu', 'Tra cứu giúp tôi dữ liệu đã lưu của phiên này'],
    ['M7-noi-tiep', 'Nói tiếp về đối thủ MoMo đi, nó mạnh ở điểm nào?'],
    ['M8-anaphora', 'Còn cái ví kia thì sao? So sánh nó với MoMo'],
    ['M9-doi-chu-de', 'Thôi bỏ ví điện tử. Tối nay nấu gì ngon với 100k cho 2 người?'],
    ['M10-quay-lai', 'Quay lại FastPay: theo em team 8 người có kịp deadline tháng 12 không?'],
    ['M11-kiem-tra-nho', 'Tôi tên gì, bao nhiêu tuổi, làm gì, dự án tên gì, team mấy người?'],
    ['M12-toan', 'Tính giúp: budget 500 triệu, đã tiêu 37%, còn lại bao nhiêu?'],
    ['M13-skill-sai', 'Dùng skill ghost-skill-khong-co giúp tôi'],
    ['M14-email', 'Viết email xin sếp gia hạn deadline FastPay thêm 1 tháng, lý do team thiếu tester'],
    ['M15-chuyen-sau', 'Đào sâu vụ thị phần: ZaloPay và ShopeePay thằng nào đang lên?'],
    ['M16-tom-tat', 'Tóm tắt toàn bộ những gì mình đã trao đổi từ đầu tới giờ'],
    ['M17-yeu-cau-kho', 'Phân tích SWOT cho FastPay trong 6 tháng tới, mỗi mục ít nhất 3 ý'],
    ['M18-cam-xuc', 'Tôi stress quá với deadline, động viên tôi vài câu đi'],
    ['M19-ky-thuat', 'Giải thích cho non-tech hiểu: API webhook là gì, ví dụ với FastPay'],
    ['M20-tam-biet', 'Cảm ơn, hôm nay tới đây thôi. Nhắc lại tên tôi và dự án để chắc bạn còn nhớ'],
  ]
  for (const [label, q] of Q) {
    const r = await ask(root, m, q, label)
    if (r && r.content.includes('[tool_call:')) fb('RAC', `${label}: final chứa nhãn nội bộ`)
  }

  // Soát memory store của Minh
  const mem = root.get('memory') as unknown as FakeMemory
  const keys = [...mem.store.keys()]
  fb('INFO', `memory keys=${JSON.stringify(keys)}`)
  const recallProbe = await mem.recall('sess-minh', 'tên tôi là gì', 3, { userId: 'user-minh' })
  fb('INFO', `recall probe (Minh hỏi tên): ${JSON.stringify(recallProbe.map((e) => e.text.slice(0, 60)))}`)

  // ═══ Session LAN (owner khác): kiểm tra cách ly memory + kiến thức ═══
  const l = new Session('sess-lan', 25, undefined, 'default', 40, 'user-lan')
  const rLan = await ask(root, l, 'Chào bạn, tôi tên Lan. Bạn có biết Minh làm dự án gì không?', 'L1-cach-ly')
  if (rLan && /fastpay/i.test(String(rLan.content))) fb('LEAK-USER', 'Lan hỏi mà model tiết lộ dự án của Minh!')
  else fb('INFO', 'Cách ly user OK (không rò FastPay sang Lan)')

  // ═══ Session COMPACT: ép nén thật (limit nhỏ) rồi kiểm tra tiếp tục nhiệm vụ ═══
  console.log('\n═══ Session COMPACT (ép nén) ═══')
  // compactor đã mount với default; ép bằng history dài: 8 turn nội dung dày
  const cc = new Session('sess-compact', 25)
  const meat = 'Bối cảnh dự án Phoenix: ' + 'xây app giao đồ ăn tại Đà Nẵng, vốn 2 tỷ, team 12 người gồm 7 dev 3 design 2 QA. '.repeat(8)
  for (let i = 1; i <= 8; i++) {
    await ask(root, cc, `${meat} Câu hỏi ${i}: tiến độ tuần ${i} nên tập trung vào module nào?`, `C${i}`)
  }
  const evC = await root.storage.readEvents(cc.id)
  const compacted = evC.filter((e) => e.type === 'context_compacted')
  fb('INFO', `compaction events=${compacted.length}, quality=${JSON.stringify(compacted.map((e: any) => e.quality))}`)
  await ask(root, cc, 'Nhắc lại cho tôi: dự án tên gì, vốn bao nhiêu, team mấy người, ở thành phố nào?', 'C9-quiz-sau-nen')
  await ask(root, cc, 'Viết tiếp kế hoạch tuần 9 dựa trên mọi thứ đã bàn', 'C10-tiep-tuc')

  // Tổng soát rác toàn bộ sessions
  for (const sid of ['sess-minh', 'sess-lan', 'sess-compact']) {
    const evs = await root.storage.readEvents(sid)
    const bad = evs.filter((e) => (e.type === 'model_message' || e.type === 'final') && JSON.stringify(e).includes('[tool_call:'))
    if (bad.length) fb('RAC', `${sid}: ${bad.length} event hiển thị dính nhãn`)
  }

  await root.fiber.dispose()
  rmSync(base, { recursive: true, force: true })
  console.log('\n==== FEEDBACK LOG ====')
  for (const l2 of log) console.log(l2)
  process.exit(0)
}
main().catch((e) => { console.error('CRASH:', e); process.exit(1) })
