// apps/web/src/AssistantMarkdown.tsx — Phase 10.4: port đúng pattern
// AssistantMarkdown thật của dsh (packages/client/ui-conversation) — câu trả
// lời assistant KHÔNG phải bubble, chảy full-width, render markdown thật
// (model trả lời có markdown thật — **in đậm**, danh sách — đã xác nhận qua
// log chat thật ở Phase 8/9, UI trước đây hiện nguyên dấu `**`/`*` thô).
//
// Dùng thư viện thật (`react-markdown`), không tự viết parser — tự chế
// markdown parser rủi ro sai edge case cao, không đáng (coding rule A6 áp
// dụng cả hướng "đừng tự xây cái đã có thư viện tốt").
//
// Bug thật user báo (2026-08): bảng markdown (cú pháp GFM `| a | b |`) model
// trả về không vẽ được thành bảng — `react-markdown` mặc định chỉ parse
// CommonMark thuần, KHÔNG hỗ trợ bảng/strikethrough/task-list (đó là phần mở
// rộng GFM, cần plugin `remark-gfm` riêng, xác nhận qua đọc docs thư viện,
// không phải bug của react-markdown). Thêm plugin + bọc `<table>` trong div
// `overflow-x: auto` riêng (coding rule chung của repo: nội dung rộng tự
// cuộn trong khung của nó, không làm cả trang cuộn ngang) — bảng nhiều cột
// trong báo cáo business-case-builder thường rộng hơn khung chat.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './AssistantMarkdown.module.css'

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className={styles.tableWrap}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
