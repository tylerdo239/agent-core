// bundles/adapters/web-ui — Phase 7.1/9.6: chat UI, serve static file thuần.
//
// KHÔNG inject seam nào — bundle này chỉ đọc file từ `apps/web/dist` (build
// output Vite, Phase 9.4/9.6 — trước đó Phase 7.1-9.5 serve `./public` viết
// tay, xem lịch sử Git nếu cần đối chiếu) và trả về qua HTTP, không chạm
// ctx.sessions/ctx.agent/... Toàn bộ logic nghiệp vụ (tạo session, gửi
// message, nhận stream) chạy Ở PHÍA BROWSER (apps/web/src/App.tsx), gọi
// thẳng vào bundles/adapters/api-rest + api-ws như 1 client bên ngoài — đúng
// nguyên tắc "adapter không chứa business logic", áp dụng cho UI y hệt
// REST/WS/gRPC, không có ngoại lệ.
//
// LƯU Ý: `apps/web/dist` PHẢI được build trước (`npm run build:web`) — bundle
// này không tự build, chỉ serve. `npm test` có `pretest` tự chạy build:web
// (xem package.json); Docker có build stage riêng (xem Dockerfile).
//
// Cùng lifecycle pattern (coding rule A13): apply async, return disposer
// trực tiếp.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'

export namespace WebUi {
  export interface Config {
    /** 0 = để OS tự chọn cổng trống (dùng trong test); mặc định 8790 cho chạy tay. */
    port?: number
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// bundles/adapters/web-ui -> lên 3 cấp tới agent-core/ -> apps/web/dist.
const DIST_DIR = path.join(__dirname, '../../../apps/web/dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
}

export const apply = async (ctx: Context, config: WebUi.Config = {}) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname
    // Chống path traversal: KHÔNG dùng basename() nữa (Vite build output có
    // thư mục con thật, vd. /assets/index-XXXX.js — basename() sẽ làm mất
    // "assets/" nên không tìm thấy file). Thay bằng containment check: join
    // rồi normalize, xác nhận đường dẫn kết quả vẫn nằm TRONG DIST_DIR.
    // LƯU Ý (verify thực nghiệm khi viết test): với input thật qua
    // `new URL()`, nhánh 403 dưới đây hiếm khi thật sự bị kích hoạt — '..'
    // RAW trong URL bị chính WHATWG URL parser tự "remove dot segments"
    // TRƯỚC KHI code này chạy (`url.pathname` không bao giờ còn '..' thật),
    // và '..' ENCODED (%2F) không tự decode qua `url.pathname` (không gọi
    // decodeURIComponent) nên bị coi là 1 ký tự tên file bình thường, không
    // phải dấu phân cách. Giữ containment check này như phòng thủ theo lớp
    // (defense-in-depth) — rẻ, không sai — không phải cơ chế chính đang chặn
    // 2 case phổ biến trên (đã verify: cả 2 kết thúc ở 404, không phải 403).
    const filePath = path.normalize(path.join(DIST_DIR, pathname))
    if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden')
      return
    }
    try {
      const content = await readFile(filePath)
      const ext = path.extname(filePath)
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' })
      res.end(content)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    }
  })

  await new Promise<void>((resolve) => server.listen(config.port ?? 8790, resolve))
  const address = server.address()
  if (address && typeof address === 'object') config.port = address.port
  ctx.logger('web-ui').info('listening on :%d', config.port)

  return () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
}
