# Thêm 1 plugin vào agent-core

Có 2 cách, tuỳ bạn có đang sửa trực tiếp source agent-core hay không.

| | Sửa source? | Khi nào dùng |
|---|---|---|
| **Nội bộ** (`bundles/`) | Có | Đóng góp vào chính agent-core, cần review/PR |
| **Bên ngoài** (`EXTRA_PLUGINS`) | Không | Bên thứ ba deploy agent-core, muốn thêm capability riêng mà không fork repo |

Cả 2 cách dùng **chung 1 contract plugin** — không có API riêng nào phải học thêm cho cách "bên ngoài".

## 1. Contract plugin (chung cho cả 2 cách)

Mọi plugin — nội bộ hay bên ngoài — là 1 module export đúng hình dạng Cordis chấp nhận:

```ts
import { Context } from '@deepseek-ai/cordis'

// Tuỳ chọn — khai service cần sẵn trước khi plugin này load. Cordis tự
// chờ, tự unload/reload lại khi dependency mất/có lại (spatial
// composability) — không cần tự quản lý thứ tự.
export const inject = ['tools']

// Bắt buộc — entrypoint Cordis gọi khi mount.
export const apply = async (ctx: Context, config?: MyConfig) => {
  ctx.tools.add({
    name: 'my_tool',
    description: '...',
    async handler(args, toolContext) {
      return { ok: true }
    },
  })
}
```

Có thể dùng `export default` thay `apply` — Cordis unwrap `exports.default ?? exports`. Chỉ nên dùng 1 trong 2, không cả hai (default thừa có thể âm thầm che mất `apply`/`inject` khác nếu bạn export sai cách).

Muốn logic nghiệp vụ tách khỏi lớp đăng ký, hoặc có phần Python riêng — xem [`docs/plugin-standard-structure.md`](plugin-standard-structure.md) (cấu trúc `src/`/`python/`/`ui/`/`tests/` tham khảo, không bắt buộc theo đúng 100% — agent-core hiện dùng `index.ts` phẳng cho hầu hết bundle, xem ví dụ thật bất kỳ trong `bundles/`).

## 2. Cách nội bộ — thêm vào `bundles/`

1. Tạo `bundles/<category>/<name>/index.ts` (category: `providers`/`tools`/`skills`/`loop-drivers`/`prompts`/`adapters` — khớp seam nó implement).
2. Thêm 2 dòng vào `src/serve.ts`:
   ```ts
   import * as myPlugin from '../bundles/tools/my-plugin/index.ts'
   // ... trong main():
   mount('my-plugin', 'tool', myPlugin, { /* config */ })
   ```
3. `npm run typecheck && npm test`.

Đây chính là cách toàn bộ ~28 bundle hiện có được mount — không có gì mới, chỉ ghi lại cho đầy đủ.

## 3. Cách bên ngoài — `EXTRA_PLUGINS` (không sửa source)

`src/serve.ts` đọc 2 biến môi trường, KHÔNG cần biết trước tên plugin của bạn:

```
EXTRA_PLUGINS="<name>:<specifier>[,<name>:<specifier>,...]"
EXTRA_PLUGIN_CONFIG__<name>='<JSON, tuỳ chọn>'
```

- **`name`** — nhãn hiển thị (xuất hiện trong `GET /plugins` / panel "Plugin đang chạy" trên UI, category `external`) và cũng là khoá để tra `EXTRA_PLUGIN_CONFIG__<name>`.
- **`specifier`**:
  - Bắt đầu bằng `.` hoặc `/` → path plugin **local** (chưa publish), resolve tương đối thư mục gốc agent-core.
  - Ngược lại → **npm package name** thật, resolve qua `node_modules` bình thường (phải `npm install` trước).
- **`EXTRA_PLUGIN_CONFIG__<name>`** — tuỳ chọn, 1 chuỗi JSON, trở thành `config` truyền vào `apply(ctx, config)`. Không set → `config = undefined`, plugin tự đọc `process.env` bên trong (đúng cách nhiều bundle nội bộ vẫn làm, vd. `llm-qwen` đọc `OPENAI_API_KEY` trực tiếp).

Nhiều plugin: phân tách bởi dấu phẩy — `EXTRA_PLUGINS="a:pkg-a,b:pkg-b"`.

### Ví dụ tối thiểu — 1 tool "hello" từ package riêng

**`@myorg/agent-core-plugin-hello/index.ts`**:
```ts
import { Context } from '@deepseek-ai/cordis'

export const inject = ['tools']

export const apply = async (ctx: Context, config?: { greeting?: string }) => {
  ctx.tools.add({
    name: 'hello',
    description: 'Trả lời chào hỏi tuỳ chỉnh',
    async handler() {
      return { message: config?.greeting ?? 'hello from a third-party plugin' }
    },
  })
}
```

**`.env`** (hoặc biến môi trường container):
```
EXTRA_PLUGINS=hello:@myorg/agent-core-plugin-hello
EXTRA_PLUGIN_CONFIG__hello={"greeting":"xin chào từ plugin ngoài"}
```

```bash
npm install @myorg/agent-core-plugin-hello
npx tsx src/serve.ts
```

Log boot in ra `[extra-plugin] mounted "hello" từ "@myorg/agent-core-plugin-hello"`. Xác nhận đã mount: `GET /plugins` (admin token) hoặc panel "Plugin đang chạy" trên sidebar sẽ thấy entry `{ name: "hello", category: "external", state: "active" }`.

### Plugin local, chưa publish (path tương đối)

```
EXTRA_PLUGINS=hello:./my-local-plugins/hello/index.ts
```
Không cần `npm install` — resolve trực tiếp path đó tính từ thư mục gốc agent-core.

## 4. Xác minh sau khi thêm

- `GET /plugins` (hoặc panel "Plugin đang chạy") — entry có mặt, `state: "active"`.
- Test tool/skill/provider bạn vừa thêm hoạt động qua flow bình thường (chat gọi tool, v.v.).
- Container log không có dòng `FATAL: EXTRA_PLUGINS ...` (format sai) hay `FATAL: env var EXTRA_PLUGIN_CONFIG__... phải là JSON hợp lệ` (config sai) — service sẽ **không boot** nếu 1 trong 2 sai, thay vì âm thầm bỏ qua plugin đó.

## 5. Giới hạn, biết trước

- **Không hot-reload** — đổi `EXTRA_PLUGINS`/`EXTRA_PLUGIN_CONFIG__*` cần restart service (khớp mọi biến môi trường khác của agent-core, vd. `API_KEYS` trước đây, `STORAGE_RETENTION_DAYS`...).
- **Không có UI enable/disable runtime** — muốn tắt 1 plugin ngoài, xoá khỏi `EXTRA_PLUGINS` và restart.
- **Full-trust, cùng process** — plugin ngoài chạy trong CÙNG process Node, có quyền truy cập `ctx` y hệt bundle nội bộ (mọi seam nó `inject` được). Đây là mức tin cậy y hệt bất kỳ package bạn `npm install`; agent-core không sandbox hoá plugin bên ngoài. Chỉ trỏ `EXTRA_PLUGINS` vào code bạn tin tưởng.
- Khác dsh (`cordis-plugin-loader` + profile YAML + patch overlay đa lớp): agent-core cố tình không dùng cơ chế đó — `EXTRA_PLUGINS` là danh sách tường minh, không auto-scan, không group/hierarchy, không patch theo id. Nếu nhu cầu thật sự lớn hơn (nhiều profile, hot-reload, marketplace plugin cộng đồng), đó là quyết định kiến trúc riêng, chưa cần thiết ở quy mô hiện tại.
