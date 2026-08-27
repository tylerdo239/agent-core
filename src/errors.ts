// Harness error taxonomy — ngôn ngữ chung cho MỌI nguồn lỗi trong fox-harness.
//
// Bài toán thật (probe matrix v2-round-0 + report user): model không hề biết
// turn trước/executed cell vừa fail — lỗi bị nuốt ở biên TS↔Python hoặc trả
// về dưới dạng "thành công" với nội dung rỗng. Taxonomy này gắn mã máy đọc
// được cho từng lớp lỗi và sinh câu feedback CHUẨN để đưa NGAY VÀO prompt của
// model (in-band), thay vì chỉ log ra UI.

export type HarnessErrorCode =
  // ── Model-output errors (model cần thấy để tự sửa) ──
  | 'CODE_PARSE'       // thiếu ```repl fence, JSON-wrapped action, format sai
  | 'NO_PROGRESS'      // iteration không tiến triển (resubmit y hệt, cạn vòng)
  | 'TOOL_ARGS'        // tham số tool sai schema/semantics
  | 'TOOL_EXEC'        // tool handler throw / timeout
  | 'TOOL_NOT_FOUND'
  | 'SKILL_MISSING'    // skill/resource không tồn tại
  | 'SKILL_READ'
  // ── Infrastructure errors (model cần biết để tránh kẹt lại) ──
  | 'CODE_RUNTIME'     // exception Python trong cell
  | 'LLM_PROVIDER'     // 400/429/500 từ LLM API
  | 'CONTEXT_OVERFLOW' // sắp/vượt context, compact thất bại
  | 'CONTRACT'         // TS ↔ Python payload lệch schema
  | 'WORKER'           // python worker crash/ENOENT/protocol violation
  | 'STATE_CORRUPT'    // session state poisoned (BUG-09 class)
  | 'HUMAN_DENIED'     // human-control bị từ chối
  | 'CANCELLED'
  | 'TIMEOUT'

export interface ErrorDescriptor {
  /** Model-facing one-liner: chuyện gì vừa xảy ra. */
  readonly summary: string
  /** Model-facing hành động cụ thể nên làm tiếp. */
  readonly guidance: string
  /** recoverable = model có thể tự sửa trong cùng turn/session. */
  readonly recoverable: boolean
}

export const ERROR_TAXONOMY: Readonly<Record<HarnessErrorCode, ErrorDescriptor>> = {
  CODE_PARSE: {
    summary: 'Your previous response was not executable: it had no fenced ```repl block (or wrapped actions in JSON/prose).',
    guidance: 'Emit exactly one concise intent sentence followed by one fenced ```repl block containing Python. The block itself IS the action.',
    recoverable: true,
  },
  NO_PROGRESS: {
    summary: 'The previous iteration made no progress (identical resubmission or iteration budget exhausted).',
    guidance: 'Change approach explicitly: inspect different state, use a different tool/helper, or submit the best supported partial answer now.',
    recoverable: true,
  },
  TOOL_ARGS: {
    summary: 'A host-tool call had invalid arguments.',
    guidance: 'Re-read the tool signature from available_tools, fix the arguments, and retry once with corrected values.',
    recoverable: true,
  },
  TOOL_EXEC: {
    summary: 'A host-tool execution failed or timed out.',
    guidance: 'Inspect the error payload; retry once only if transient, otherwise choose an alternative evidence path and state the limitation.',
    recoverable: true,
  },
  TOOL_NOT_FOUND: {
    summary: 'The requested tool does not exist in available_tools.',
    guidance: 'Do not invent tools. Pick the closest existing tool or explain what is missing.',
    recoverable: true,
  },
  SKILL_MISSING: {
    summary: 'The requested skill/resource does not exist.',
    guidance: 'Check exact names from skill_catalog; do not fabricate skill content.',
    recoverable: true,
  },
  SKILL_READ: {
    summary: 'Reading the skill resource failed.',
    guidance: 'Continue with the loaded instructions you already have; name the resource as unavailable.',
    recoverable: true,
  },
  CODE_RUNTIME: {
    summary: 'The executed Python cell raised an exception.',
    guidance: 'Read the traceback, fix the specific cause, and rerun a corrected cell. Never resubmit the identical failing code.',
    recoverable: true,
  },
  LLM_PROVIDER: {
    summary: 'The model provider returned an HTTP error (rate limit / bad request / server error).',
    guidance: 'Do not assume the task progressed. Wait-free alternatives first; if persisting, surface the provider error instead of guessing results.',
    recoverable: false,
  },
  CONTEXT_OVERFLOW: {
    summary: 'Context is at/near its limit or compaction failed.',
    guidance: 'Stop loading new data. Summarize findings so far into your own compact variables and finish with the strongest partial answer.',
    recoverable: true,
  },
  CONTRACT: {
    summary: 'Internal harness contract violation between TypeScript and Python layers.',
    guidance: 'The turn cannot proceed reliably; report what was completed before the violation.',
    recoverable: false,
  },
  WORKER: {
    summary: 'The Python worker crashed or became unreachable.',
    guidance: 'Runtime state may be inconsistent; re-establish needed state before continuing.',
    recoverable: false,
  },
  STATE_CORRUPT: {
    summary: 'Session runtime state was found corrupted (e.g., illegal write to immutable context).',
    guidance: 'Recreate required variables from context payloads before continuing; never write into context/context_N.',
    recoverable: true,
  },
  HUMAN_DENIED: {
    summary: 'The human denied the pending action approval.',
    guidance: 'Proceed WITHOUT the blocked action using an alternative approach, or explain why the task cannot continue without it.',
    recoverable: true,
  },
  CANCELLED: {
    summary: 'The run was cancelled by the user.',
    guidance: 'No further work should be attempted for this request.',
    recoverable: false,
  },
  TIMEOUT: {
    summary: 'The run exceeded its time limit.',
    guidance: 'Deliver the strongest partial result and clearly name what remains undone.',
    recoverable: false,
  },
}

export function isHarnessErrorCode(value: unknown): value is HarnessErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_TAXONOMY, value)
}

/**
 * Phân loại message lỗi tự do thành mã taxonomy. Dùng ở biên (worker events,
 * provider exceptions, tool handlers) nơi chưa ai gắn mã sẵn.
 */
export function classifyError(message: string): HarnessErrorCode {
  const m = String(message ?? '')
  const has = (...patterns: RegExp[]) => patterns.some((p) => p.test(m))
  // LLM provider: số lỗi HTTP nằm TRƯỚC hoặc SAU từ khoá provider (cả 2 chiều).
  if (
    has(
      /\b(llm|openai|provider|api)\b[^.]{0,60}\b(4\d\d|5\d\d)\b/i,
      /\b(429|500|502|503|504)\b[^.]{0,60}\b(llm|openai|provider|api)\b/i,
      /rate.?limit/i,
    )
    && !has(/tool|skill/i)
  ) {
    return 'LLM_PROVIDER'
  }
  if (has(/ENOENT|worker (crashed|died|unreachable|ended)|broker shut|ended without a (turn )?result/i)) return 'WORKER'
  if (has(/contract validation|validatePreparedTurn|schema.*violat/i)) return 'CONTRACT'
  if (has(/exceeded maxSteps|compaction|context (remains above|limit)/i)) return 'CONTEXT_OVERFLOW'
  // str(KeyError('x')) === "'x'" — repr chuỗi trích đơn là dấu hiệu đặc trưng.
  if (has(/^'[^'\n]+'$|Traceback|ZeroDivision|NameError|AttributeError|SyntaxError|(KeyError|TypeError)\b/)) return 'CODE_RUNTIME'
  if (isHarnessErrorCode(m.trim())) return m.trim() as HarnessErrorCode
  if (has(/tool .* not found/i)) return 'TOOL_NOT_FOUND'
  if (has(/timeout sau|timed out/i)) return 'TIMEOUT'
  if (has(/cancelled|aborted/i)) return 'CANCELLED'
  return 'WORKER'
}

/**
 * Dòng [SESSION HEALTH] chèn đầu prompt khi turn TRƯỚC trong cùng session đã
 * crash — để model hiện tại biết trạng thái có thể bất ổn định thay vì đi tiếp
 * như không có chuyện gì (đúng complaint "nó cứ tiếp tục làm mà không biết đang lỗi").
 */
export function sessionHealthNote(lastError?: { code?: string; message?: string }): string {
  if (!lastError?.message) return ''
  const code = isHarnessErrorCode(lastError.code) ? lastError.code : classifyError(lastError.message)
  const descriptor = ERROR_TAXONOMY[code]
  return [
    '',
    '## Session health notice',
    `- The PREVIOUS turn crashed with [${code}] ${descriptor.summary}`,
    `- ${descriptor.guidance}`,
    '- Verify any runtime state you are about to reuse before relying on it.',
  ].join('\n')
}

/** Feedback block chèn vào observation stream IN-BAND cho model. */
export function inBandFeedback(code: HarnessErrorCode, detail?: string): string {
  const d = ERROR_TAXONOMY[code]
  const lines = [`[HARNESS ERROR ${code}] ${d.summary}`, `ACTION REQUIRED: ${d.guidance}`]
  if (detail) lines.push(`DETAIL: ${detail}`)
  if (!d.recoverable) lines.push('This error class is not self-recoverable mid-turn.')
  return lines.join('\n')
}
