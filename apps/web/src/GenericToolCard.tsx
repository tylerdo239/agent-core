// apps/web/src/GenericToolCard.tsx — Phase 9.4: fallback BẮT BUỘC cho slot
// 'tool.call.toolview' — tool KHÔNG có UI-plugin riêng (đa số tool tương
// lai) vẫn hiển thị hợp lý qua đây. Đọc `toolUi.render` (Phase 8.5, forward
// qua LoopStep.toolUi) để chọn giữa 2 kiểu: 'citations' (danh sách nguồn
// đánh số, mirror WebBlock thật của dsh) hoặc 'io' — mặc định (card IN/OUT
// chung). Port trực tiếp từ buildSearchSources()/buildIoCard() trong
// bundles/adapters/web-ui/public/app.js (Phase 7/8.5), viết lại thành
// component React thay vì hàm dựng DOM thủ công — KHÔNG đổi logic.
//
// Đơn giản hoá có chủ đích so với app.js cũ: citations rỗng giờ hiện 1 dòng
// "không tìm thấy kết quả" NGAY TRONG body (luôn trả về node, không null) —
// app.js cũ trả `null` để ToolRow tự gỡ chevron (không cho expand). Giữ luôn
// chevron mở được đơn giản hơn (ToolRow không cần biết body "có rỗng không"),
// đánh đổi UX chấp nhận được: xem Phase 9.4 trong build-plan.
import type { ToolViewOwnerProps } from '@agent-core/ui-slots'

interface SearchResult {
  title?: string
  url: string
  snippet?: string
}

function sourceLabel(url: string, title?: string): string {
  if (title) return title
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function SearchSources({ results }: { results: SearchResult[] }) {
  if (!results.length) return <p className="tool-io-text">không tìm thấy kết quả</p>
  return (
    <ol className="tool-sources">
      {results.map((r, i) => (
        <li className="tool-source" key={r.url + i}>
          <a className="tool-source-link" href={r.url} target="_blank" rel="noopener noreferrer">
            {sourceLabel(r.url, r.title)}
          </a>
          {r.snippet && <div className="tool-source-snippet">{r.snippet}</div>}
        </li>
      ))}
    </ol>
  )
}

function IoCard({ inputText, result }: { inputText: string; result: unknown }) {
  return (
    <div className="tool-io">
      <div className="tool-io-row">
        <span className="tool-io-label">IN</span>
        <span className="tool-io-text">{inputText}</span>
      </div>
      <div className="tool-io-row">
        <span className="tool-io-label">OUT</span>
        <span className="tool-io-text">{JSON.stringify(result)}</span>
      </div>
    </div>
  )
}

export function GenericToolCard({ toolCall, result, toolUi }: ToolViewOwnerProps) {
  const parsed = result as { results?: SearchResult[] } | null | undefined
  if (toolUi?.render === 'citations' && parsed && Array.isArray(parsed.results)) {
    return <SearchSources results={parsed.results} />
  }
  return <IoCard inputText={JSON.stringify(toolCall.args ?? {})} result={result} />
}
