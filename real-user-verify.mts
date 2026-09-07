import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from './bundles/providers/tool-registry/index.ts'
import * as skillRegistry from './bundles/providers/skill-registry/index.ts'
import * as stateSqlite from './bundles/providers/state-sqlite/index.ts'
import * as loopRegistry from './bundles/providers/loop-registry/index.ts'
import * as loopDefault from './bundles/loop-drivers/loop-default/index.ts'
import * as agentRunner from './bundles/providers/agent-runner/index.ts'
import * as promptRegistry from './bundles/providers/prompt-registry/index.ts'
import * as promptDefaultAgent from './bundles/prompts/prompt-default-agent/index.ts'
import * as contextCompactorLlm from './bundles/providers/context-compactor-llm/index.ts'
import * as llmQwen from './bundles/providers/llm-qwen/index.ts'
import { Session } from './seams/loop.ts'

async function main() {
  const root = new Context()
  root.plugin(toolRegistry); root.plugin(skillRegistry)
  root.plugin(promptRegistry); root.plugin(promptDefaultAgent)
  root.plugin(contextCompactorLlm)
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(llmQwen)
  root.plugin(loopRegistry); root.plugin(loopDefault); root.plugin(agentRunner)
  await new Promise((r) => setTimeout(r, 2000))
  const s = new Session('verify-1', 25)
  // KHÔNG mount skillSelection -> không tốn request router, đỡ quota
  const r1 = await root.agent.runTurn('default', s, 'Cho tôi biết tin mới nhất về thị trường cà phê Việt Nam năm nay')
  console.log('T2-answer:', String(r1.content).slice(0, 500))
  await new Promise((r) => setTimeout(r, 8000))
  const r2 = await root.agent.runTurn('default', s, 'Lúc nãy bạn nói giá cà phê robusta bao nhiêu 1kg? Trích nguyên văn câu bạn đã nói.')
  console.log('T17-answer:', String(r2.content).slice(0, 800))
  await root.fiber.dispose()
  process.exit(0)
}
main().catch((e) => { console.error('CRASH:', String(e.message).slice(0, 200)); process.exit(1) })
