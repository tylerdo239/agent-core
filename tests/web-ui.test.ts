// Phase 7.1/9.6 deliverable (phần server): mount → serve đúng file từ
// apps/web/dist (Vite build output, Phase 9.4/9.6 — trước đó serve
// bundles/adapters/web-ui/public/ viết tay) → unmount → cổng đóng sạch. Test
// bằng fetch thật, không mock. `apps/web/dist` PHẢI tồn tại trước khi chạy
// (script `pretest` ở package.json tự `npm run build:web`).
//
// KHÔNG hardcode tên file JS/CSS (Vite build ra tên có content-hash, đổi mỗi
// lần build, vd. assets/index-XXXX.js) — đọc index.html thật để tìm đúng tên
// file, rồi mới fetch file đó, đúng cách 1 trình duyệt thật sẽ làm.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as webUi from '../bundles/adapters/web-ui/index.ts'

let cleanup: (() => Promise<unknown>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

describe('Phase 7.1/9.6 — web-ui static server (serve apps/web/dist)', () => {
  it('serve index.html, tìm đúng asset .js/.css qua chính index.html (tên có content-hash)', async () => {
    const root = new Context()
    const config: webUi.WebUi.Config = { port: 0 }
    const fiber = root.plugin(webUi, config)
    await fiber.await()
    cleanup = () => fiber.dispose()
    const base = `http://127.0.0.1:${config.port}`

    const index = await fetch(`${base}/`)
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toContain('text/html')
    const html = await index.text()
    expect(html).toContain('<div id="root">')

    const jsMatch = html.match(/src="(\/assets\/[^"]+\.js)"/)
    const cssMatch = html.match(/href="(\/assets\/[^"]+\.css)"/)
    expect(jsMatch, `index.html phải reference 1 file .js dưới /assets/ — html thật:\n${html}`).toBeTruthy()
    expect(cssMatch, `index.html phải reference 1 file .css dưới /assets/`).toBeTruthy()

    const js = await fetch(`${base}${jsMatch![1]}`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')

    const css = await fetch(`${base}${cssMatch![1]}`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
  })

  it('404 cho file không tồn tại; path traversal (encoded hoặc raw) KHÔNG bao giờ lộ file ngoài apps/web/dist', async () => {
    const root = new Context()
    const config: webUi.WebUi.Config = { port: 0 }
    const fiber = root.plugin(webUi, config)
    await fiber.await()
    cleanup = () => fiber.dispose()
    const base = `http://127.0.0.1:${config.port}`

    expect((await fetch(`${base}/khong-ton-tai.html`)).status).toBe(404)

    // 2 lớp phòng thủ khác nhau, verify thực nghiệm riêng (không suy đoán):
    // (1) `..` RAW trong URL (`/../../../etc/passwd`) bị chính WHATWG URL
    //     parser tự "remove dot segments" TRƯỚC KHI code chạm vào —
    //     `new URL('/../../../etc/passwd', ...).pathname` đã ra thẳng
    //     '/etc/passwd' (không còn '..' nào), nên `path.join(DIST_DIR, ...)`
    //     luôn nằm trong DIST_DIR — an toàn, nhưng KHÔNG PHẢI nhờ code của
    //     mình, mà nhờ hành vi chuẩn của URL parser.
    // (2) `..` ENCODED (`%2F`) không tự decode qua `url.pathname` (server
    //     không gọi decodeURIComponent) nên bị coi là 1 tên file lạ, không
    //     phải dấu phân cách thư mục — cũng an toàn, cũng không chạm containment
    //     check (path.normalize + startsWith DIST_DIR trong bundle) vì
    //     path.join không thấy '..' thật nào để normalize.
    // Cả 2 đường đều kết thúc ở 404 (không phải lộ file hệ thống nào) — đó
    // là điều thật sự cần verify, không phải status code cụ thể 403 mà code
    // hiện tại (containment check) chưa từng thực sự là đường phòng thủ được
    // kích hoạt cho 2 case này.
    const rawTraversal = await fetch(`${base}/../../../etc/passwd`)
    expect(rawTraversal.status).toBe(404)
    expect(await rawTraversal.text()).not.toContain('root:')

    const encodedTraversal = await fetch(`${base}/..%2F..%2F..%2Fetc%2Fpasswd`)
    expect(encodedTraversal.status).toBe(404)
    expect(await encodedTraversal.text()).not.toContain('root:')
  })

  it('mount -> unmount -> cổng đóng sạch', async () => {
    const root = new Context()
    const config: webUi.WebUi.Config = { port: 0 }
    const fiber = root.plugin(webUi, config)
    await fiber.await()
    const base = `http://127.0.0.1:${config.port}`

    expect((await fetch(`${base}/`)).status).toBe(200)

    await fiber.dispose()

    await expect(fetch(`${base}/`)).rejects.toThrow()
  })
})
