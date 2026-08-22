# Cấu trúc chuẩn 1 Plugin (Cordis) — logic Python, wrap bằng TS

Dựa trên `omdsh-dev/plugin-template` (template chính thức trong hệ sinh thái dsh), áp dụng cho core `@deepseek-ai/cordis` tự dựng. Ví dụ chính lấy đúng case phổ biến nhất: **logic thật viết Python, TS chỉ là lớp vỏ mỏng đăng ký vào Cordis.**

## Cấu trúc thư mục đầy đủ

```
bundles/tool-web-search-google/          # tên bundle = tên thư mục
├── src/                      # LỚP VỎ TS — chỉ đăng ký, KHÔNG chứa logic nghiệp vụ
│   ├── index.ts              # Loader metadata — CHỈ export, không logic
│   ├── config.ts             # schema cấu hình (zod)
│   ├── runtime.ts            # mount MCP client trỏ tới python/server.py
│   └── invariant.ts          # (tuỳ chọn) ràng buộc dữ liệu nếu plugin sở hữu 1 event/state quan trọng
│
├── python/                   # LOGIC THẬT — toàn bộ nghiệp vụ nằm ở đây
│   ├── server.py              # MCP server — implement tool bằng Python
│   └── requirements.txt
│
├── ui/                        # (tuỳ chọn) chỉ có nếu tool cần hiển thị riêng, không dùng fallback
│   ├── ToolView.tsx
│   ├── ToolView.module.css    # CSS Modules bắt buộc — chặn class-name collision
│   └── register.ts            # gọi registerToolView(tool_name, ToolView)
│
├── tests/
│   ├── harness.ts             # mount Cordis THẬT (không mock) để test tích hợp
│   └── plugin.spec.ts         # test export + activation + dispose
│
├── cordis.patch.yml           # khai báo cách host mount plugin này vào profile
├── package.json               # có field "dsh.bundle.patch" trỏ tới cordis.patch.yml
└── tsconfig.json
```

**Điểm mấu chốt của cấu trúc này:** `src/` (TS) không chứa 1 dòng logic nghiệp vụ nào — nó chỉ biết cách *khởi động* và *kết nối* tới `python/server.py`. Toàn bộ business logic (gọi API, xử lý dữ liệu, tính toán) nằm 100% trong Python, độc lập, test được riêng, không phụ thuộc Cordis.

---

## `python/server.py` — logic thật, viết thuần Python

```python
from mcp.server.fastmcp import FastMCP
import httpx, os

mcp = FastMCP("web-search-google")

GOOGLE_API_KEY = os.environ["GOOGLE_API_KEY"]
GOOGLE_CSE_ID = os.environ["GOOGLE_CSE_ID"]

@mcp.tool()
async def web_search(query: str, num_results: int = 5) -> list[dict]:
    """Tìm kiếm Google, trả về title/link/snippet của kết quả hàng đầu."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": GOOGLE_API_KEY, "cx": GOOGLE_CSE_ID, "q": query, "num": min(num_results, 10)},
        )
        resp.raise_for_status()
        data = resp.json()

    return [
        {"title": item["title"], "link": item["link"], "snippet": item.get("snippet", "")}
        for item in data.get("items", [])
    ]

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

```
# python/requirements.txt
mcp
httpx
```

Test độc lập, không cần Cordis/dsh khởi động:
```bash
pip install -r python/requirements.txt
export GOOGLE_API_KEY=xxx GOOGLE_CSE_ID=xxx
python python/server.py
```

---

## `src/index.ts` — Loader metadata, tuyệt đối không chứa logic

```typescript
export const name = 'tool-web-search-google'
export const inject: string[] = []          // MCP tool tự chứa logic, không cần dependency nội bộ
export { Config } from './config.ts'
export { apply } from './runtime.ts'

// ⚠️ TUYỆT ĐỐI KHÔNG thêm `export default` ở đây.
// Cordis Loader unwrap exports.default ?? exports — 1 default export thừa sẽ
// âm thầm xoá mất inject/Config/apply, không báo lỗi rõ ràng.
```

## `src/config.ts` — schema cấu hình, tách khỏi logic

```typescript
import { z } from 'zod'

export interface Config {
  googleApiKey: string
  googleCseId: string
}

export const Config = z.object({
  googleApiKey: z.string(),
  googleCseId: z.string(),
})
```

## `src/runtime.ts` — CHỈ mount MCP client, không tự implement search

```typescript
import { Context } from '@deepseek-ai/cordis'
import { McpClient } from '@deepseek-ai/dsh-mcp-client'
import path from 'node:path'
import type { Config } from './config.ts'

export function apply(ctx: Context, config: Config): void {
  ctx.plugin(McpClient, {
    serverName: 'web-search-google',
    transport: 'stdio',
    command: 'python3',
    args: [path.resolve(import.meta.dirname, '../python/server.py')],
    env: {
      GOOGLE_API_KEY: config.googleApiKey,
      GOOGLE_CSE_ID: config.googleCseId,
    },
  })

  ctx.logger('tool-web-search-google').info('mounted Python MCP server')
}
```

---

## `tests/harness.ts` + `plugin.spec.ts` — test với Cordis thật

```typescript
// tests/harness.ts
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.ts'

export function mountTestContext() {
  const root = new Context()
  root.plugin(plugin, { googleApiKey: 'test-key', googleCseId: 'test-cse' })
  return root
}
```

```typescript
// tests/plugin.spec.ts
import { mountTestContext } from './harness.ts'

test('MCP tool đăng ký đúng, và gỡ sạch subprocess khi dispose', async () => {
  const ctx = mountTestContext()
  await ctx.start()
  expect(ctx.tools.has('mcp__web-search-google__web_search')).toBe(true)

  await ctx.fiber.dispose()
  expect(ctx.tools.has('mcp__web-search-google__web_search')).toBe(false)
  // xác nhận thêm: subprocess Python đã bị kill, không còn process con sống sót
})
```

## `cordis.patch.yml` — manifest thật để host mount plugin

```yaml
plugins:
  ~tool-web-search-google:
    googleApiKey: ${GOOGLE_API_KEY}
    googleCseId: ${GOOGLE_CSE_ID}
```

## `package.json` — khai báo bundle patch + postinstall cài Python deps

```json
{
  "name": "@your-scope/tool-web-search-google",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": ["dsh-plugin"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1"
  },
  "dependencies": {
    "@deepseek-ai/dsh-mcp-client": "^0.1.0",
    "zod": "^3"
  },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "postinstall": "pip install -r python/requirements.txt --break-system-packages"
  }
}
```

---

## Nếu tool có UI riêng — thư mục `ui/` (đổi tên từ `frontend/`)

```typescript
// ui/register.ts
import { registerToolView } from '@/core/toolViewRegistry'
import { ToolView } from './ToolView'

registerToolView('web_search', ToolView)   // string PHẢI khớp tool_name Python trả về trong transformResult
```

```tsx
// ui/ToolView.tsx
import styles from './ToolView.module.css'

type Props = { summary?: string; data: { items: { title: string; link: string; snippet: string }[] } }

export function ToolView({ summary, data }: Props) {
  return (
    <div className={styles.container}>
      {summary && <p className={styles.summary}>{summary}</p>}
      <ul className={styles.list}>
        {data.items.map((item, i) => (
          <li key={i} className={styles.item}>
            <a href={item.link} target="_blank" rel="noreferrer">{item.title}</a>
            <p>{item.snippet}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Wiring ở app frontend (điểm duy nhất phải sửa tay khi thêm plugin mới có UI):
```typescript
// frontend/src/plugins/index.ts
import '../../../bundles/tool-web-search-google/ui/register'
```

---

## Sơ đồ trách nhiệm — ai làm gì trong plugin này

```
src/ (TS)                          python/ (Python)                 ui/ (React, tuỳ chọn)
  ├─ đăng ký vào Cordis Context      ├─ toàn bộ logic nghiệp vụ         ├─ hiển thị kết quả
  ├─ khai báo inject/Config          ├─ gọi API bên ngoài                ├─ CSS cách ly (Modules)
  ├─ mount MCP client, KHÔNG          ├─ xử lý/transform dữ liệu          ├─ đăng ký vào registry
  │  tự implement search             ├─ test độc lập, không cần            frontend, key = tool_name
  └─ cleanup khi dispose (subprocess)    Cordis/TS
```

## Checklist tạo 1 plugin mới theo mẫu này

1. Copy `plugin-template`, đổi tên trong `package.json`, `src/index.ts`, `cordis.patch.yml`
2. Viết `python/server.py` trước — implement + test logic độc lập, không phụ thuộc TS
3. Viết `src/config.ts` (schema) → `src/runtime.ts` (chỉ mount MCP client) → `src/index.ts` (export, không logic)
4. Nếu cần UI riêng → thêm `ui/`, CSS Modules bắt buộc, đăng ký đúng `tool_name` khớp Python
5. Viết `tests/harness.ts` mount Cordis thật, test cả activate lẫn dispose (kể cả subprocess Python bị kill đúng cách)
6. Kiểm tra không có `export default` thừa trong `src/index.ts`
7. `postinstall` tự cài `requirements.txt` khi `npm install` — không bắt người dùng tự cài Python deps tay
8. `pnpm run build && pnpm test` trước khi publish
