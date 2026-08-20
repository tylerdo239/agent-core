// packages/ui-primitives/src/StateDot.tsx — chấm tròn báo trạng thái nhỏ,
// dùng cho header status (thay/kèm chữ màu đơn thuần trước đây).
import styles from './StateDot.module.css'

export type StateDotVariant = 'connected' | 'disconnected' | 'connecting' | 'error'

export interface StateDotProps {
  variant: StateDotVariant
  /** Label cho screen reader — chấm màu thuần không đủ thông tin cho a11y. */
  label?: string
}

export function StateDot({ variant, label }: StateDotProps) {
  return <span className={`${styles.dot} ${styles[variant]}`} role={label ? 'status' : undefined} aria-label={label} />
}
