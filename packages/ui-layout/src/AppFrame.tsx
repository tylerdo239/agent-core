// packages/ui-layout/src/AppFrame.tsx — shell THUẦN (mirror dsh's AppFrame,
// packages/client/ui-layout), trích ra từ JSX khung ngoài của App.tsx (#app/
// #main/header/#messages container) ở phase restructure UI mirror dsh —
// KHÔNG đổi hành vi/CSS, chỉ đổi vị trí + đóng gói thành slot props.
//
// Đơn giản hoá có chủ đích so với AppFrame thật của dsh (3 cột resizable
// sidebar/center/details, coding rule A6): agent-core chỉ có 2 cột cố định
// (sidebar + main), không có "details panel" — không có tính năng tương ứng
// để hiện ở đó. KHÔNG biết nội dung cụ thể (không hardcode "agent-core" hay
// bất kỳ text/component app-specific nào) — mọi nội dung qua props, đúng
// tinh thần "shell thuần" của dsh: ui-layout không phụ thuộc ui-conversation/
// ui-sidebar/ui-settings-general, ngược lại mới đúng.
import type { ReactNode } from 'react'
import styles from './AppFrame.module.css'

export interface AppFrameProps {
  sidebar: ReactNode
  header: ReactNode
  /**
   * Hàng phụ tuỳ chọn NGAY DƯỚI `header`, trên `children` — vùng chrome cố
   * định riêng (không cuộn theo message), TÁCH KHỎI `header` có chủ đích:
   * `.header` (AppFrame.module.css) là `display:flex; justify-content:
   * space-between` cho ĐÚNG 2 phần tử (tiêu đề + trạng thái) trên 1 hàng —
   * nhét thêm nội dung khác (vd. workspace bar của RLM) làm phần tử thứ 3
   * vào CÙNG hàng flex đó khiến mọi thứ bị ép chung 1 dòng ngang với tiêu
   * đề thay vì xuống hàng riêng (gap thật phát hiện sau khi dùng `header`
   * cho việc này — xem docs/agent-core-rlm-web-ui-plugin-plan.md). `null`/
   * `undefined` = không hiện gì, không tốn khoảng trống (không phải div
   * rỗng còn border/padding).
   */
  subHeader?: ReactNode
  footer: ReactNode
  children: ReactNode
}

export function AppFrame({ sidebar, header, subHeader, footer, children }: AppFrameProps) {
  return (
    <div className={styles.app}>
      {sidebar}
      <div className={styles.main}>
        <header className={styles.header}>{header}</header>
        {subHeader}
        <main className={styles.messages} aria-live="polite">
          {children}
        </main>
        {footer}
      </div>
    </div>
  )
}
