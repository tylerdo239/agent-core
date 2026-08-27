// apps/web/src/MessageBubble.tsx — UI redesign (2026-08): tách ra khỏi
// App.tsx (trước đây render inline bằng className template string, không
// map được lên CSS Modules' static property access) + thêm hover-reveal
// timestamp/copy cho user/assistant (mới, không có tiền lệ trước đây).
//
// `ts` để undefined khi không có (session dựng lại từ GET /sessions/:id/
// events KHÔNG có timestamp lưu server-side — xem App.tsx reconstructItems())
// — component tự bỏ qua, không hiện timestamp rỗng/sai.
import { Copy } from 'lucide-react'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import styles from './MessageBubble.module.css'

export type MessageBubbleKind = 'user' | 'assistant' | 'system' | 'error' | 'critic'

export interface MessageBubbleProps {
  kind: MessageBubbleKind
  text: string
  description?: string
  ts?: number
  /** Bubble assistant NÀY đang nhận token 'stream' dở dang — App.tsx truyền
   * theo đúng id đang stream (xem AssistantMarkdown.tsx cho lý do: tránh
   * react-markdown parse 1 bảng/cú pháp GFM đang gõ dở, có thể đứng yên mãi
   * ở dạng thô nếu turn kết thúc/lỗi đúng lúc đó). */
  streaming?: boolean
  /** Gọi SAU KHI đã copy vào clipboard thành công — App.tsx dùng để push toast xác nhận. */
  onCopied?: () => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({ kind, text, description, ts, streaming, onCopied }: MessageBubbleProps) {
  const cssKind = kind === 'critic' ? 'step' : kind

  if (kind !== 'user' && kind !== 'assistant') {
    return (
      <div className={`${styles.msg} ${styles[cssKind]}`} title={description}>
        <span className={styles.activityTitle}>{text}</span>
        {description && <span className={styles.separator}>·</span>}
        {description && <span className={styles.description}>{description}</span>}
      </div>
    )
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    onCopied?.()
  }

  return (
    <div className={`${styles.wrapper} ${kind === 'user' ? styles.wrapperUser : styles.wrapperAssistant}`}>
      <div className={`${styles.msg} ${styles[cssKind]}`}>{kind === 'assistant' ? <AssistantMarkdown content={text} streaming={streaming} /> : text}</div>
      <div className={styles.actions}>
        {ts !== undefined && <span className={styles.timestamp}>{formatTime(ts)}</span>}
        <button type="button" className={styles.copyBtn} onClick={handleCopy} aria-label="Sao chép">
          <Copy size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
