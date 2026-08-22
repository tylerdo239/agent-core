// apps/web/src/EmptyState.tsx — UI redesign (2026-08): trước đây #messages
// rỗng chỉ là 1 khung trắng, không gợi ý gì cho user mới mở app lần đầu
// (gap thật audit tìm thấy, không phải bổ sung tuỳ hứng). Icon đổi sang
// lucide-react (follow-up sau khi thêm dependency này cho Sidebar) thay vì
// emoji 💬 trước đây — nhất quán 1 bộ icon xuyên suốt app.
import { MessageSquare } from 'lucide-react'
import styles from './EmptyState.module.css'

export function EmptyState() {
  return (
    <div className={styles.empty}>
      <span className={styles.icon} aria-hidden="true">
        <MessageSquare size={32} strokeWidth={1.5} />
      </span>
      <p className={styles.title}>Bắt đầu cuộc trò chuyện mới</p>
      <p className={styles.caption}>Nhắn gì đó ở khung bên dưới để bắt đầu.</p>
    </div>
  )
}
