// bundles/tool-web-search — Phase 3 ví dụ #3 (tool ↔ permission), NÂNG CẤP:
// search thật, 2 provider — Serper.dev (chính, cần API key trả phí) với
// DuckDuckGo (dự phòng, không cần key) tự động thay thế khi Serper lỗi/hết
// quota, thay vì chỉ trả status code.
//
// Coding rule B1: bất kỳ tool nào chạm tài nguyên ngoài (network, ở đây)
// PHẢI inject permission và tự check trước khi chạy — không giả định caller
// đã check hộ.
//
// Thiết kế fallback (2026-08, user đăng ký serper.dev, muốn làm provider
// CHÍNH — DuckDuckGo chỉ dự phòng khi Serper lỗi/hết limit): model chỉ thấy
// ĐÚNG 1 tool `web_search` — provider nào phục vụ là chi tiết nội bộ, không
// lộ ra thành 2 tool riêng (tránh model phải tự chọn nhầm). Không cấu hình
// key ở đâu cả -> bỏ qua Serper hoàn toàn, chạy y hệt trước đây (DuckDuckGo
// only, zero migration bắt buộc). Có key nhưng request lỗi (network/timeout/
// non-2xx, gồm cả 429 rate-limit) -> log cảnh báo rồi fallback DuckDuckGo
// NGAY LẦN GỌI ĐÓ, không retry Serper (Serper là API trả phí có hạn mức,
// DuckDuckGo là lưới an toàn miễn phí — không đáng retry tốn thời gian
// trước khi fallback).
//
// Follow-up (admin config qua UI, không cần restart): key giờ đọc LIVE mỗi
// lần handler chạy qua `ctx.pluginConfig.get('serperApiKey')` (Postgres,
// seams/plugin-config.ts) thay vì đóng băng lúc mount — admin đổi/xoá key
// qua packages/ui-plugin-settings có hiệu lực NGAY, không cần restart
// service. `config.serperApiKey` (env, tham số mount cũ) vẫn giữ làm giá
// trị mặc định khi DB CHƯA có key nào — DB luôn thắng nếu có, không phải
// 2 nguồn loại trừ nhau.
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
     * định 60s), không cùng ngân sách thời gian. Dùng chung cho cả 2 provider
     * (Serper/DuckDuckGo) — cùng 1 ngân sách thời gian cho 1 lượt search.
     */
    timeoutMs?: number
    /** API key serper.dev — không set = bỏ qua Serper, chỉ dùng DuckDuckGo (mặc định, tương thích ngược hoàn toàn). */
    serperApiKey?: string
    /** Override cho test — mặc định endpoint search thật của serper.dev. */
    serperBaseUrl?: string
  }
}

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_SERPER_BASE_URL = 'https://google.serper.dev/search'

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

async function searchDuckDuckGo(query: string, limit: number, timeoutMs: number): Promise<WebSearchResult[]> {
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
  return parseResults(html, limit)
}

interface SerperOrganicResult {
  title?: string
  link?: string
  snippet?: string
}

// Chỉ đọc `organic` (kết quả tự nhiên) — bỏ qua `peopleAlsoAsk`/
// `relatedSearches`/knowledge graph: giữ đúng shape WebSearchResult chung
// cho cả 2 provider, model/UI không cần biết khác biệt nội bộ.
async function searchSerper(
  query: string,
  limit: number,
  apiKey: string,
  timeoutMs: number,
  baseUrl: string,
): Promise<WebSearchResult[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ q: query, num: limit }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`web_search: Serper timeout sau ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) {
    // Gồm cả 429 (rate-limit) và hết quota tháng — caller fallback DuckDuckGo
    // cho MỌI status lỗi, không phân biệt riêng 429, đúng yêu cầu "lỗi hay
    // hết limit đều fallback".
    throw new Error(`web_search: Serper trả lỗi (${res.status} ${res.statusText})`)
  }

  const data = (await res.json()) as { organic?: SerperOrganicResult[] }
  const organic = Array.isArray(data.organic) ? data.organic : []
  return organic.slice(0, limit).map((item) => ({
    title: item.title ?? '',
    url: item.link ?? '',
    snippet: item.snippet ?? '',
  }))
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

  const serperBaseUrl = config.serperBaseUrl ?? DEFAULT_SERPER_BASE_URL

  ctx.tools.add({
    name: 'web_search',
    description:
      'Tìm kiếm web thật (ưu tiên Serper.dev nếu đã cấu hình, tự động dùng DuckDuckGo khi chưa cấu hình hoặc Serper lỗi/hết hạn mức), trả về danh sách kết quả gồm title/url/snippet.',
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
    ui: { icon: '🔍', label: 'Tìm kiếm web', render: 'citations', summaryArg: 'query' },
    // Follow-up (2026-08): tool tự khai field cấu hình của chính mình (xem
    // ToolConfigField ở seams/tools.ts) -- admin UI (packages/ui-plugin-
    // settings) đọc field này qua GET /tool-config-schema thay vì 1 danh
    // sách hardcode tách rời, để tool bên thứ 3 tự ctx.tools.add() cũng
    // xuất hiện đúng trong UI cấu hình mà không cần sửa source lõi.
    configSchema: [
      {
        key: 'serperApiKey',
        label: 'Web search Serper',
        description: 'Dùng cho tìm kiếm web (tool web_search) làm provider chính. Chưa cấu hình → tự động dùng DuckDuckGo (không cần key).',
      },
    ],
    async handler(args, _context) {
      const allowed = await ctx.permission.check('web-search', 'search')
      if (!allowed) throw new Error('permission denied')

      const query = String(args.query ?? '')
      const limit =
        typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), MAX_LIMIT) : DEFAULT_LIMIT

      // DB (admin cấu hình qua UI, đổi được không cần restart) LUÔN thắng
      // nếu có; config.serperApiKey (env, giá trị mount ban đầu) chỉ là mặc
      // định khi DB CHƯA từng lưu key nào — không phải 2 nguồn loại trừ
      // nhau. `ctx.get('pluginConfig')` (không phải property access trực
      // tiếp) vì `pluginConfig` không nằm trong `inject` của bundle này —
      // seam optional, tool vẫn chạy được (DuckDuckGo-only) nếu vì lý do
      // nào đó ctx.pluginConfig chưa mount (test cô lập, deployment tối giản).
      const serperApiKey = (await ctx.get('pluginConfig')?.get('serperApiKey')) ?? config.serperApiKey

      if (serperApiKey) {
        try {
          const results = await searchSerper(query, limit, serperApiKey, timeoutMs, serperBaseUrl)
          return { query, results, provider: 'serper' }
        } catch (err) {
          ctx.logger('tool-web-search').warn(
            'Serper thất bại (%s) — fallback DuckDuckGo cho lượt search này',
            err instanceof Error ? err.message : String(err),
          )
        }
      }

      const results = await searchDuckDuckGo(query, limit, timeoutMs)
      return { query, results, provider: 'duckduckgo' }
    },
  })

  ctx.logger('tool-web-search').info('activated — permission dependency satisfied')
}
