// packages/ui-primitives/src/Toast.tsx — thông báo nổi, tự biến mất sau 1
// khoảng thời gian — dùng cho lỗi hệ thống/kết nối (khác lỗi trong lúc chạy
// turn, vẫn hiện dạng bubble trong chat vì đó là nội dung hội thoại thật,
// không phải thông báo hệ thống thoáng qua).
import { useCallback, useState } from 'react'
import styles from './Toast.module.css'

export interface ToastItem {
  id: string
  message: string
  tone?: 'default' | 'error'
}

let nextToastId = 0

export function useToasts(autoDismissMs = 4000) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback(
    (message: string, tone: ToastItem['tone'] = 'default') => {
      nextToastId += 1
      const id = `toast-${nextToastId}`
      setToasts((prev) => [...prev, { id, message, tone }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, autoDismissMs)
    },
    [autoDismissMs],
  )

  return { toasts, push }
}

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null
  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${t.tone === 'error' ? styles.error : ''}`} role="status">
          {t.message}
        </div>
      ))}
    </div>
  )
}
