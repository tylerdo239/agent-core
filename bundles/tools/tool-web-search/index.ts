// bundles/tool-web-search — Phase 3 ví dụ #3 (tool ↔ permission), NÂNG CẤP:
// search thật qua DuckDuckGo (không cần API key) thay vì chỉ trả status code.
//
// Coding rule B1: bất kỳ tool nào chạm tài nguyên ngoài (network, ở đây)
// PHẢI inject permission và tự check trước khi chạy — không giả định caller
// đã check hộ.
//
// Dùng `html.duckduckgo.com/html/` (bản dành cho client không chạy JS) thay
// vì trang chính — cấu trúc HTML ổn định hơn để parse, không cần JS/headless
// browser. Cấu trúc parser bên dưới đã verify bằng cách curl trực tiếp
// endpoint thật trước khi viết, không đoán mò. Đây vẫn là scrape HTML (không
// phải API chính thức) — DuckDuckGo có thể đổi markup hoặc chặn request bất
// thường bất kỳ lúc nào; parser trả mảng rỗng (không throw) nếu không tìm
// thấy kết quả nào, để model xử lý như "không tìm thấy" thay vì lỗi cứng.
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/permission.ts'
import '../../../seams/prompt.ts'
import '../../../seams/tools.ts'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export const inject = ['permission', 'tools', 'prompts']

export namespace ToolWebSearch {
  export interface Config {
    /**
     * Gap thật phát hiện qua audit (đối chiếu docs/agent-core-master-summary.md
     * — "timeout riêng từng tool" chưa build): trước đây `fetch()` gọi
     * DuckDuckGo KHÔNG có timeout gì — nếu DuckDuckGo treo, cả turn treo vô
     * thời hạn theo (không giống `llm-qwen` đã có AbortController từ Phase
     * 8.3). Mặc định 10s — web search cần nhanh hơn LLM call nhiều (LLM mặc
     * định 60s), không cùng ngân sách thời gian.
     */
    timeoutMs?: number
  }
}

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10
const DEFAULT_TIMEOUT_MS = 10_000

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).trim()
}

// DuckDuckGo trả link kết quả qua redirect nội bộ
// (//duckduckgo.com/l/?uddg=<url-encoded-real-url>&rut=...) — giải mã ra URL
// thật, không trả thẳng link redirect cho model.
function decodeDdgRedirect(href: string): string | null {
  try {
    const url = new URL(href.startsWith('//') ? `https:${href}` : href)
    const real = url.searchParams.get('uddg')
    return real ? decodeURIComponent(real) : null
  } catch {
    return null
  }
}

function parseResults(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const blocks = html.split('<div class="result results_links').slice(1)
  for (const block of blocks) {
    if (results.length >= limit) break
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!titleMatch) continue
    const url = decodeDdgRedirect(titleMatch[1])
    if (!url) continue
    const snippetMatch = block.match(/class="result__snippet"[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    results.push({
      title: stripHtml(titleMatch[2]),
      url,
      snippet: snippetMatch ? stripHtml(snippetMatch[1]) : '',
    })
  }
  return results
}

export const apply = (ctx: Context, config: ToolWebSearch.Config = {}) => {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Guidance xuyên nhiều lần gọi thuộc chính tool plugin, không thuộc persona
  // RLM. Khi tool unload, section cũng tự gỡ theo cùng Cordis fiber.
  ctx.prompts.section({
    name: 'tool:web_search',
    order: 110,
    text: [
      'Web-search guidance:',
      '- Use `web_search(query, limit=5)` for current or externally verifiable information; `limit` is capped at 10.',
      '- The result contains `query` and `results`, where each result has `title`, `url`, and `snippet`.',
      '- Treat snippets as leads, not complete evidence. Do not claim details absent from the returned text.',
      '- Cite relevant returned URLs as Markdown links in the final answer.',
    ].join('\n'),
  })

  ctx.tools.add({
    name: 'web_search',
    description: 'Tìm kiếm web thật (qua DuckDuckGo), trả về danh sách kết quả gồm title/url/snippet.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: `Số kết quả tối đa (mặc định ${DEFAULT_LIMIT}, tối đa ${MAX_LIMIT})` },
      },
      required: ['query'],
    },
    // Phase 8.5: tool tự khai cách hiển thị — web-ui đọc field này thay vì
    // hardcode theo tên "web_search".
    ui: { icon: '🔍', label: 'Tìm kiếm web', render: 'citations' },
    async handler(args) {
      const allowed = await ctx.permission.check('web-search', 'search')
      if (!allowed) throw new Error('permission denied')

      const query = String(args.query ?? '')
      const limit =
        typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), MAX_LIMIT) : DEFAULT_LIMIT

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      let res: Response
      try {
        res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: controller.signal,
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error(`web_search: DuckDuckGo timeout sau ${timeoutMs}ms`)
        }
        throw err
      } finally {
        clearTimeout(timeout)
      }
      if (!res.ok) {
        throw new Error(`web_search: DuckDuckGo trả lỗi (${res.status} ${res.statusText})`)
      }

      const html = await res.text()
      const results = parseResults(html, limit)

      return { query, results }
    },
  })

  ctx.logger('tool-web-search').info('activated — permission dependency satisfied')
}
