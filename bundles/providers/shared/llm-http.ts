import { LlmError } from '../../../seams/llm.ts'

export interface PostChatOptions {
  url: string
  apiKey: string
  body: Record<string, unknown>
  timeoutMs?: number
  maxRetries?: number
  retryBaseDelayMs?: number
  signal?: AbortSignal
  deadline?: number
  warn(message: string, ...args: unknown[]): void
}

const RETRYABLE = new Set([429, 500, 502, 503, 504])

const MAX_ERROR_DETAIL_CHARS = 600

function cleanErrorDetail(raw: string): string {
  let detail = raw
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const nested = parsed.error && typeof parsed.error === 'object'
      ? parsed.error as Record<string, unknown>
      : undefined
    detail = String(nested?.message ?? parsed.message ?? parsed.detail ?? '')
  } catch { /* plain-text upstream error */ }
  return detail
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_DETAIL_CHARS)
}

async function statusError(provider: string, response: Response) {
  const raw = await response.text().catch(() => '')
  const detail = cleanErrorDetail(raw)
  const suffix = detail ? `: ${detail}` : ''
  if (response.status === 401 || response.status === 403) return new LlmError('LLM_AUTH', `${provider}: authentication failed (${response.status})${suffix}`, response.status)
  if (response.status === 429) return new LlmError('LLM_RATE_LIMITED', `${provider}: rate limited${suffix}`, response.status)
  if (response.status >= 500) return new LlmError('LLM_SERVER_ERROR', `${provider}: server error ${response.status}${suffix}`, response.status)
  return new LlmError('LLM_REQUEST_INVALID', `${provider}: request rejected ${response.status}${suffix}`, response.status)
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new LlmError('LLM_CANCELLED', 'cancelled during retry delay')
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    timer.unref?.()
    signal?.addEventListener('abort', done, { once: true })
  })
  if (signal?.aborted) throw new LlmError('LLM_CANCELLED', 'cancelled during retry delay')
}

export async function postChatCompletion(options: PostChatOptions, provider: string) {
  const timeoutMs = options.timeoutMs ?? 60_000
  const operationDeadline = Math.min(options.deadline ?? Number.POSITIVE_INFINITY, Date.now() + timeoutMs)
  const retries = options.maxRetries ?? 2
  const delay = options.retryBaseDelayMs ?? 300

  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw new LlmError('LLM_CANCELLED', `${provider}: cancelled`)
    const remaining = operationDeadline - Date.now()
    if (remaining <= 0) throw new LlmError('LLM_TIMEOUT', `${provider}: operation deadline exceeded`)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), remaining)
    timer.unref?.()
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal
    let response: Response | undefined
    let failure: unknown
    try {
      response = await fetch(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify(options.body), signal,
      })
    } catch (error) { failure = error } finally { clearTimeout(timer) }

    if (options.signal?.aborted) throw new LlmError('LLM_CANCELLED', `${provider}: cancelled`)
    if (timeout.signal.aborted) throw new LlmError('LLM_TIMEOUT', `${provider}: timed out after ${timeoutMs}ms`)
    if (response?.ok) return response

    const retryable = failure !== undefined || (response !== undefined && RETRYABLE.has(response.status))
    if (!retryable || attempt >= retries) {
      if (response) throw await statusError(provider, response)
      throw new LlmError('LLM_NETWORK', `${provider}: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
    await response?.body?.cancel().catch(() => undefined)
    options.warn('retry %d/%d after %s', attempt + 1, retries, response ? `HTTP ${response.status}` : 'network error')
    await sleep(Math.min(delay * 2 ** attempt, Math.max(operationDeadline - Date.now(), 0)), options.signal)
  }
}
