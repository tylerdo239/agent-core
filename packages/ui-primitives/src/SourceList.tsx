// packages/ui-primitives/src/SourceList.tsx — UI redesign (2026-08): trước
// đây danh sách "nguồn tham khảo" bị viết TRÙNG gần như nguyên văn ở 2 nơi
// (apps/web/src/GenericToolCard.tsx SearchSources + packages/ui-tool-web-
// search/src/WebSearchCard.tsx) — mỗi bên tự có sourceLabel() + JSX riêng,
// dùng chung class name global gây va chạm (tool-source*). Gộp về đây (cùng
// lý do Button sống ở package này chứ không phải apps/web: WebSearchCard
// KHÔNG thể phụ thuộc ngược vào apps/web).
//
// `collapsibleSnippets` phân biệt 2 cách dùng: WebSearchCard (UI-plugin thật,
// có state cục bộ, cho user tự ẩn/hiện từng snippet) truyền true; fallback
// GenericToolCard (không state cục bộ theo thiết kế) để mặc định false —
// snippet luôn hiện tĩnh.
import { useState } from 'react'
import { Button } from './Button.tsx'
import styles from './SourceList.module.css'

export interface SourceListResult {
  title?: string
  url: string
  snippet?: string
}

export interface SourceListProps {
  results: SourceListResult[]
  collapsibleSnippets?: boolean
}

function sourceLabel(url: string, title?: string): string {
  if (title) return title
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function SourceList({ results, collapsibleSnippets = false }: SourceListProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<number>>(new Set())

  if (!results.length) return <p className={styles.empty}>không tìm thấy kết quả</p>

  function toggle(i: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <ol className={styles.list}>
      {results.map((r, i) => (
        <li className={styles.item} key={r.url + i}>
          <a className={styles.link} href={r.url} target="_blank" rel="noopener noreferrer">
            {sourceLabel(r.url, r.title)}
          </a>
          {r.snippet &&
            (collapsibleSnippets ? (
              <>
                <Button type="button" size="sm" onClick={() => toggle(i)}>
                  {expandedIds.has(i) ? 'ẩn mô tả' : 'xem mô tả'}
                </Button>
                {expandedIds.has(i) && <div className={styles.snippet}>{r.snippet}</div>}
              </>
            ) : (
              <div className={styles.snippet}>{r.snippet}</div>
            ))}
        </li>
      ))}
    </ol>
  )
}
