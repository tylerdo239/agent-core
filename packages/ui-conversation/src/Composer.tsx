// apps/web/src/Composer.tsx — UI redesign (2026-08): tách ra khỏi App.tsx
// (trước đây <input type="text"> đơn dòng, không hỗ trợ xuống dòng) + sửa
// gap chức năng thật: đổi sang <textarea> tự giãn cao theo nội dung (kỹ
// thuật scrollHeight chuẩn), Enter gửi/Shift+Enter xuống dòng.
import { useEffect, useRef } from 'react'
import { Button } from '@agent-core/ui-primitives'
import styles from './Composer.module.css'

const MAX_HEIGHT_PX = 160

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  /** Gate theo trạng thái kết nối/session/turn — KHÔNG theo nội dung rỗng
   * hay không (textarea vẫn phải gõ được lúc rỗng, chỉ nút Gửi mới dim khi
   * rỗng — xem canSend bên dưới). */
  disabled: boolean
}

export function Composer({ value, onChange, onSubmit, disabled }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const canSend = !disabled && value.trim().length > 0

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        placeholder="Nhắn gì đó cho agent..."
        rows={1}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button type="submit" variant="primary" className={styles.send} disabled={!canSend}>
        Gửi
      </Button>
    </form>
  )
}
