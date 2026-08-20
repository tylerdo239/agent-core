// apps/web/src/AssistantMarkdown.tsx — Phase 10.4: port đúng pattern
// AssistantMarkdown thật của dsh (packages/client/ui-conversation) — câu trả
// lời assistant KHÔNG phải bubble, chảy full-width, render markdown thật
// (model trả lời có markdown thật — **in đậm**, danh sách — đã xác nhận qua
// log chat thật ở Phase 8/9, UI trước đây hiện nguyên dấu `**`/`*` thô).
//
// Dùng thư viện thật (`react-markdown`), không tự viết parser — tự chế
// markdown parser rủi ro sai edge case cao, không đáng (coding rule A6 áp
// dụng cả hướng "đừng tự xây cái đã có thư viện tốt").
import ReactMarkdown from 'react-markdown'

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
