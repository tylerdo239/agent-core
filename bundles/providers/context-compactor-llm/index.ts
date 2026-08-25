import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  CompactContextResult,
  ContextCompactorService,
  ContextInspection,
  StructuredSummaryInput,
} from '../../../seams/context-compactor.ts'
import { LlmMessage, LlmToolSpec } from '../../../seams/llm.ts'

const COMPACTION_PROMPT = readFileSync(
  fileURLToPath(new URL('./prompt.md', import.meta.url)),
  'utf8',
).trim()

export namespace ContextCompactorLlm {
  export interface Config {
    contextLimitTokens?: number
    thresholdPct?: number
    nearThresholdPct?: number
    summaryMaxTokens?: number
  }
}

const DEFAULT_CONTEXT_LIMIT = 30_000
const DEFAULT_THRESHOLD = 0.8
const DEFAULT_NEAR_THRESHOLD = 0.8
const DEFAULT_SUMMARY_MAX_TOKENS = 1_200

function clip(value: unknown, limit: number) {
  const text = String(value ?? '').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`
}

function estimate(value: unknown): number {
  // Không có tokenizer model-specific ở TypeScript. UTF-8 bytes / 3 bảo thủ
  // hơn chars / 4 cho tiếng Việt/CJK; cộng overhead để không đợi sát limit.
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 3) + 8
}

function parseJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('structured summarizer returned a non-object')
  }
  return value as Record<string, unknown>
}

function fallbackTranscript(messages: LlmMessage[], limit = 5_000): string {
  if (!messages.length) return ''
  const lines = messages.map((message) => `${message.role}: ${clip(message.content, 1_000)}`)
  const text = lines.join('\n')
  if (text.length <= limit) return text
  const half = Math.floor((limit - 40) / 2)
  return `${text.slice(0, half)}\n[older content clipped]\n${text.slice(-half)}`
}

export class ContextCompactorLlmProvider extends ContextCompactorService {
  private readonly contextLimitTokens: number
  private readonly thresholdPct: number
  private readonly nearThresholdPct: number
  private readonly summaryMaxTokens: number

  constructor(ctx: Context, public config: ContextCompactorLlm.Config = {}) {
    super(ctx)
    this.contextLimitTokens = config.contextLimitTokens ?? DEFAULT_CONTEXT_LIMIT
    this.thresholdPct = config.thresholdPct ?? DEFAULT_THRESHOLD
    this.nearThresholdPct = config.nearThresholdPct ?? DEFAULT_NEAR_THRESHOLD
    this.summaryMaxTokens = config.summaryMaxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS
    if (!Number.isFinite(this.contextLimitTokens) || this.contextLimitTokens <= 0) {
      throw new Error('context-compactor-llm: contextLimitTokens must be positive')
    }
    if (!(this.thresholdPct > 0 && this.thresholdPct < 1)) {
      throw new Error('context-compactor-llm: thresholdPct must be between 0 and 1')
    }
    if (!(this.nearThresholdPct > 0 && this.nearThresholdPct <= 1)) {
      throw new Error('context-compactor-llm: nearThresholdPct must be between 0 and 1')
    }
  }

  [Service.init]() {
    this.ctx.logger('context-compactor-llm').info(
      'ready (context=%d, threshold=%d%%)',
      this.contextLimitTokens,
      Math.round(this.thresholdPct * 100),
    )
  }

  inspect(messages: LlmMessage[], tools: LlmToolSpec[] = []): ContextInspection {
    const estimatedTokens = estimate({ messages, tools })
    const compactionTriggerTokens = Math.max(1, Math.floor(this.contextLimitTokens * this.thresholdPct))
    return {
      estimatedTokens,
      contextLimitTokens: this.contextLimitTokens,
      compactionTriggerTokens,
      compactionProgressPercent: Math.round(estimatedTokens / compactionTriggerTokens * 10_000) / 100,
      nearCompaction: estimatedTokens >= compactionTriggerTokens * this.nearThresholdPct,
      shouldCompact: estimatedTokens >= compactionTriggerTokens,
    }
  }

  async structuredSummary(input: StructuredSummaryInput): Promise<Record<string, string>> {
    const response = await this.ctx.llm.complete([
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: JSON.stringify(input.payload) },
    ], {
      purpose: 'memory',
      maxTokens: input.maxTokens ?? this.summaryMaxTokens,
      temperature: 0,
      signal: input.signal,
    })
    const value = parseJsonObject(response.content)
    const result: Record<string, string> = {}
    for (const field of input.requiredFields) {
      if (typeof value[field] !== 'string') {
        throw new Error(`structured summarizer missing string field "${field}"`)
      }
      result[field] = String(value[field]).trim()
    }
    return result
  }

  async compact(messages: LlmMessage[], options: { signal?: AbortSignal } = {}): Promise<CompactContextResult> {
    const leadingSystem = messages[0]?.role === 'system' ? messages[0] : undefined
    const body = leadingSystem ? messages.slice(1) : messages
    let currentUserIndex = -1
    for (let index = body.length - 1; index >= 0; index--) {
      if (body[index].role === 'user') { currentUserIndex = index; break }
    }
    const prior = currentUserIndex >= 0 ? body.slice(0, currentUserIndex) : body
    const currentUser = currentUserIndex >= 0 ? body[currentUserIndex] : undefined
    const progress = currentUserIndex >= 0 ? body.slice(currentUserIndex + 1) : []
    if (!prior.length && !progress.length) {
      throw new Error('context is above threshold but contains no compactable history')
    }

    let priorSummary = ''
    let progressSummary = ''
    let quality: CompactContextResult['quality'] = 'semantic'
    let error: string | undefined
    try {
      const summary = await this.structuredSummary({
        systemPrompt: COMPACTION_PROMPT,
        payload: {
          INPUT: {
            prior_history: prior,
            current_request: currentUser?.content ?? '',
            current_progress: progress,
          },
        },
        requiredFields: ['prior_summary', 'progress_summary'],
        signal: options.signal,
      })
      priorSummary = clip(summary.prior_summary, 6_000)
      progressSummary = clip(summary.progress_summary, 6_000)
    } catch (cause) {
      quality = 'fallback'
      error = cause instanceof Error ? cause.message : String(cause)
      priorSummary = fallbackTranscript(prior)
      progressSummary = fallbackTranscript(progress)
    }

    const compacted: LlmMessage[] = []
    if (leadingSystem) compacted.push(leadingSystem)
    if (priorSummary) compacted.push({ role: 'assistant', content: `[conversation_summary]\n${priorSummary}` })
    if (currentUser) compacted.push(currentUser)
    if (progressSummary) compacted.push({ role: 'assistant', content: `[current_turn_progress]\n${progressSummary}` })
    return {
      messages: compacted,
      summary: [priorSummary, progressSummary].filter(Boolean).join('\n\n'),
      quality,
      ...(error ? { error } : {}),
    }
  }
}

export const inject = ['llm']

export const apply = async (ctx: Context, config: ContextCompactorLlm.Config = {}) => {
  await ctx.plugin(ContextCompactorLlmProvider, config)
}
