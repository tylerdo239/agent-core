// packages/ui-primitives/src/Skeleton.tsx — placeholder loading (thanh xám
// shimmer), dùng cho bất kỳ danh sách nào cần chỉ báo "đang tải" trước khi
// có kết quả thật — ví dụ đầu tiên: SearchModal (apps/web) trong lúc
// debounce chờ user dừng gõ. Thuần trang trí (aria-hidden) — nơi dùng tự
// chịu trách nhiệm báo trạng thái "đang tải" cho screen reader qua
// aria-busy/aria-live của chính nó, Skeleton không tự làm việc đó.
import styles from './Skeleton.module.css'

export interface SkeletonProps {
  /** Số dòng hiện — mặc định 3, đủ gợi ý "đang tải" mà không chiếm quá nhiều không gian. */
  rows?: number
}

const ROW_WIDTHS = ['100%', '82%', '64%']

export function Skeleton({ rows = 3 }: SkeletonProps) {
  return (
    <div className={styles.wrap} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.row} style={{ width: ROW_WIDTHS[i % ROW_WIDTHS.length] }} />
      ))}
    </div>
  )
}
