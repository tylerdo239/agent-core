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
  footer: ReactNode
  children: ReactNode
}

export function AppFrame({ sidebar, header, footer, children }: AppFrameProps) {
  return (
    <div className={styles.app}>
      {sidebar}
      <div className={styles.main}>
        <header className={styles.header}>{header}</header>
        <main className={styles.messages} aria-live="polite">
          {children}
        </main>
        {footer}
      </div>
    </div>
  )
}
