// Mirror frontend của stripLeakedToolCallLabels/sanitizeEventField trong
// src/leaked-tool-call-label.ts (backend không import sang web được).
// Mục đích: event BẨN ĐÃ LƯU trong DB production (trước khi backend sanitize)
// khi resume qua GET /events vẫn hiện rác `[tool_call:...]` — UI lột nốt lúc
// render. Hai bản phải cùng vectors (xem tests/leaked-label-strip.test.ts và
// apps/web/tests/loop-matrix-ui-sanitize.test.tsx).
const LABEL_OPEN = /\[tool_call:([a-zA-Z_][\w-]*)\(/g

function findLabelEnd(text: string, from: number): number {
  let depth = 1
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === quote) break
        i++
      }
      i++
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) {
        return text[i + 1] === ']' ? i + 2 : -1
      }
    }
    i++
  }
  return -1
}

export function stripLeakedToolCallLabels(text: string): string {
  if (!text || !text.includes('[tool_call:')) return text
  let out = ''
  let cursor = 0
  while (true) {
    LABEL_OPEN.lastIndex = cursor
    const match = LABEL_OPEN.exec(text)
    if (!match || match.index < cursor) break
    const end = findLabelEnd(text, match.index + match[0].length)
    if (end === -1) break
    out += text.slice(cursor, match.index)
    cursor = end
  }
  return out + text.slice(cursor)
}

export function sanitizeEventField(value: unknown): string {
  const stripped = stripLeakedToolCallLabels(String(value ?? ''))
  const firstLine = stripped.split('\n', 1)[0] ?? ''
  return firstLine.replace(/\r$/, '').trim()
}
