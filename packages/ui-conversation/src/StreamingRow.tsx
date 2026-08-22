// packages/ui-conversation/src/StreamingRow.tsx — chỉ báo "đang trả lời" Ở
// CẤP LƯỢT (không phải gõ từng ký tự — WS không có protocol token-delta,
// xem seams/loop.ts). Trích từ div inline trong App.tsx (UI redesign
// 2026-08) thành component riêng ở phase restructure UI mirror dsh — thuộc
// ui-conversation (không phải ui-layout, vốn là shell thuần) vì đây là nội
// dung của cuộc hội thoại, không phải khung sườn app.
import styles from './StreamingRow.module.css'

export function StreamingRow() {
  return <div className={styles.streamingRow}>đang trả lời…</div>
}
