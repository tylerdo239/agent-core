import { MemoryService } from '../../../seams/memory.ts'
import { Session, TurnInput } from '../../../seams/loop.ts'
import { PromptRegistryService } from '../../../seams/prompt.ts'
import { SkillDefinition } from '../../../seams/skill.ts'
import { WorkspaceSnapshot } from '../../../seams/workspace.ts'
import { ToolDefinition } from '../../../seams/tools.ts'
import { createContractValidator } from '../../../src/contracts.ts'

export interface RlmSessionState {
  contextIndex: number
  historyIndex: number
  pendingControl?: Record<string, unknown>
}

export interface PreparedRlmTurn {
  contractVersion: 2
  sessionId: string
  runId?: string
  requestId?: string
  request: string
  contextIndex: number
  historyIndex: number
  pendingControl?: Record<string, unknown>
  availableTools: Array<{
    name: string
    description: string
    parameters?: Record<string, unknown>
  }>
  /** Một prompt duy nhất đã được framework render và pin cho turn này. */
  prompt: string
  promptVersion: string
  context: Record<string, unknown>
  metadata?: Record<string, unknown>
}

const validatePreparedTurn = createContractValidator<PreparedRlmTurn>('rlm/v2', {
  type: 'object',
  required: ['contractVersion', 'sessionId', 'request', 'contextIndex', 'historyIndex', 'availableTools', 'prompt', 'promptVersion', 'context'],
  properties: {
    contractVersion: { const: 2 }, sessionId: { type: 'string', minLength: 1 },
    runId: { type: 'string', minLength: 1 }, requestId: { type: 'string', minLength: 1 },
    request: { type: 'string' }, contextIndex: { type: 'integer', minimum: 0 },
    historyIndex: { type: 'integer', minimum: 0 }, availableTools: { type: 'array' },
    prompt: { type: 'string', minLength: 1 }, promptVersion: { type: 'string', minLength: 1 },
    context: { type: 'object' },
  },
  additionalProperties: true,
})

function skillPayload(skill?: SkillDefinition) {
  if (!skill) return undefined
  return {
    name: skill.name,
    description: skill.description,
    content: skill.instructions,
    resources: skill.resources ?? [],
  }
}

/** Pure assembler: provider I/O diễn ra trước, contract gửi Python dựng ở một chỗ. */
export async function prepareRlmTurn(options: {
  session: Session
  input: TurnInput
  memory: MemoryService
  workspace: WorkspaceSnapshot
  skill?: SkillDefinition
  tools: ToolDefinition[]
  prompts: PromptRegistryService
}): Promise<PreparedRlmTurn> {
  const { session, input, memory, workspace, skill, tools, prompts } = options
  const state = session.extension<RlmSessionState>('loop:rlm', () => ({
    contextIndex: 0,
    historyIndex: 0,
  }))
  const snapshot = await memory.snapshot(session.id, {
    activeDatasets: workspace.resources.datasets,
    artifacts: workspace.resources.artifacts,
    currentContextIndex: state.contextIndex,
  })
  const sessionMemory = {
    summary: snapshot.summary,
    turns: snapshot.turns,
    current_context: snapshot.currentContext,
    resources: snapshot.resources,
  }
  const context: Record<string, unknown> = state.contextIndex === 0
    ? {
        type: 'user_request',
        request: input.message,
        datasets: workspace.datasets,
        active_dataset: workspace.activeDataset,
        session_memory: sessionMemory,
      }
    : {
        type: state.pendingControl ? 'human_response' : 'user_request',
        request: input.message,
        human_response: state.pendingControl
          ? { for: state.pendingControl, content: input.message }
          : undefined,
        session_memory: sessionMemory,
      }
  const selectedSkill = state.pendingControl ? undefined : skillPayload(skill)
  if (selectedSkill) context.selected_skill = selectedSkill
  const availableTools = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))
  // Runtime state stays in the REPL context. It is deliberately not rendered
  // into the system prompt, keeping instruction priority and prefix stable.
  context.available_tools = availableTools
  const prompt = prompts.render({
    driver: 'rlm',
    sessionId: session.id,
  })
  return validatePreparedTurn({
    contractVersion: 2,
    sessionId: session.id,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    request: input.message,
    contextIndex: state.contextIndex,
    historyIndex: state.historyIndex,
    pendingControl: state.pendingControl,
    availableTools,
    prompt: prompt.content,
    promptVersion: prompt.version,
    context,
    metadata: input.metadata,
  })
}
