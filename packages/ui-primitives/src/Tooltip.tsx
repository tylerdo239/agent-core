// packages/ui-primitives/src/Tooltip.tsx — tooltip CSS thuần (hover/focus),
// KHÔNG dùng thư viện positioning ngoài (floating-ui...) — đủ cho nhu cầu
// thật hiện tại (label ngắn trên nút icon), quá mức nếu cần positioning phức
// tạp (auto-flip theo viewport...) thì mới cần đổi (coding rule A6).
import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  label: string
  children: ReactNode
}

export function Tooltip({ label, children }: TooltipProps) {
  return (
    <span className={styles.wrapper}>
      {children}
      <span className={styles.bubble} role="tooltip">
        {label}
      </span>
    </span>
  )
}
