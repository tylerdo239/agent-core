# Plugin template — copy-paste để bắt đầu

Tài liệu này cho code mẫu sẵn sàng copy, đã verify thật (`npm run typecheck` sạch đối chiếu type thật của repo — không phải suy đoán API). Muốn hiểu **cơ chế** (2 cách thêm plugin, `EXTRA_PLUGINS`, cách xác minh) → xem [`docs/agent-core-adding-plugins.md`](agent-core-adding-plugins.md) trước. Tài liệu này chỉ tập trung **code mẫu**.

Có 3 loại plugin phổ biến, chọn đúng loại theo việc bạn cần làm:

| Muốn làm gì | Dùng loại nào |
|---|---|
| Model gọi được 1 hàm mới (gọi API ngoài, tính toán, tra cứu...) | **Tool** |
| Chèn hướng dẫn tĩnh vào system prompt khi tin nhắn khớp từ khoá | **Skill** |
| Expose 1 capability mới cho toàn hệ thống (`ctx.myThing...`), có thể nhiều bundle khác dùng lại | **Provider** |

## 0. Contract chung — mọi loại đều theo

```ts
import { Context } from '@deepseek-ai/cordis'

// Tuỳ chọn — khai service cần sẵn trước khi plugin này load. Cordis tự
// chờ, tự unload/reload khi dependency mất/có lại — không tự quản lý thứ tự.
export const inject = ['tools']

// Bắt buộc — entrypoint Cordis gọi khi mount. Sync hay async đều được.
export const apply = async (ctx: Context, config?: MyConfig) => {
  // ...
}
```

Có thể dùng `export default` thay `apply` (Cordis unwrap `exports.default ?? exports`) — chỉ chọn 1 trong 2, không dùng cả hai.

## 1. Template — Tool

```ts
// index.ts
import { Context } from '@deepseek-ai/cordis'

export const inject = ['tools']

export interface MyToolConfig {
  greeting?: string
}

export const apply = async (ctx: Context, config: MyToolConfig = {}) => {
  ctx.tools.add({
    name: 'my_tool',
    description: 'Mô tả ngắn gọn để model biết KHI NÀO nên gọi tool này — quan trọng, model chọn tool dựa vào đúng câu này.',
    // JSON Schema mô tả tham số — quảng bá cho model. Bỏ hẳn field này nếu
    // tool không cần tham số.
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
      required: ['input'],
    },
    // Tuỳ chọn — web-ui đọc để render tool call đẹp hơn thay vì fallback
    // chung (icon 🔧, card IN/OUT). 'citations' dùng cho tool trả list
    // nguồn (xem tool-web-search); bỏ field này nếu không cần.
    ui: { icon: '🔧', label: 'My Tool' },
    async handler(args, toolContext) {
      // toolContext.sessionId / toolContext.source — LUÔN dùng cái này để
      // biết session/nguồn gọi thật, KHÔNG tin sessionId nếu model tự
      // truyền qua args (coding rule B1 — xem Finding A1,
      // docs/agent-core-rate-limit-and-security-audit.md).
      return { echoed: args.input, sessionId: toolContext.sessionId }
    },
  })
}
```

Tool cần gọi tài nguyên ngoài (network, filesystem...) → `inject` thêm `'permission'`, tự `await ctx.permission.check(actor, action)` trước khi chạy (xem `bundles/tools/tool-web-search/index.ts` — ví dụ thật đầy đủ, có timeout/AbortController/error handling).

## 2. Template — Skill

```ts
// index.ts
import { Context } from '@deepseek-ai/cordis'

export const inject = ['skills']

export const apply = async (ctx: Context) => {
  ctx.skills.register({
    name: 'my-skill',
    description: 'Mô tả ngắn — hiện trong danh sách skill user chọn được (GET /skills).',
    // Chèn vào system prompt (message role 'system' riêng) khi skill kích hoạt.
    instructions: 'Hướng dẫn cụ thể: cách xử lý, quy tắc, ví dụ...',
    // Kích hoạt TỰ ĐỘNG khi tin nhắn user chứa 1 trong các từ khoá này
    // (so khớp substring, không phân biệt hoa/thường). Mảng rỗng = không
    // bao giờ tự kích hoạt qua match(), chỉ chọn được tường minh qua
    // `selectedSkill` (userInvocable phải true).
    triggers: ['từ khoá 1', 'từ khoá 2'],
    // true = user chọn được tường minh (dropdown "Chọn skill" trên UI).
    userInvocable: true,
  })
}
```

Skill có tài nguyên đi kèm (script/template/checklist đọc lazy) → dùng package `SKILL.md` + `resources` qua `skill-filesystem` thay vì `register()` trực tiếp — xem bất kỳ thư mục nào trong `bundles/skills/` (vd. `bundles/skills/skill-support-tone/SKILL.md`) làm mẫu.

## 3. Template — Provider (Service mới)

Chỉ cần khi bạn muốn expose 1 **capability mới cho toàn hệ thống** (`ctx.myThing.doSomething()`), không phải khi chỉ thêm 1 tool/skill đơn lẻ (2 mục trên đã đủ cho phần lớn nhu cầu).

```ts
// index.ts
import { Context, Service } from '@deepseek-ai/cordis'

// 1. Khai seam (interface) — augment Context để ctx.myThing có type đúng.
declare module '@deepseek-ai/cordis' {
  interface Context {
    myThing: MyThingService
  }
}

export abstract class MyThingService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myThing')
  }
  abstract doSomething(input: string): Promise<string>
}

// 2. Implementation thật.
export namespace MyThingProvider {
  export interface Config {
    apiKey?: string
  }
}

export class MyThingProvider extends MyThingService {
  constructor(ctx: Context, public config: MyThingProvider.Config = {}) {
    super(ctx)
  }

  async doSomething(input: string) {
    return `processed: ${input}`
  }
}

// 3. Entrypoint Cordis gọi khi mount.
export const apply = async (ctx: Context, config: MyThingProvider.Config = {}) => {
  await ctx.plugin(MyThingProvider, config)
}
```

Provider giữ state cần tự gỡ khi unload (đăng ký vào registry dùng chung, mở connection...) → bọc qua `ctx.effect()` bên trong method, KHÔNG làm trong constructor — xem `bundles/providers/tool-registry/index.ts` (`add()` dùng `this.ctx.effect()`) để tự gỡ đúng khi fiber gọi nó unload, đúng "spatial composability".

## 4. Đóng gói làm package độc lập (dùng với `EXTRA_PLUGINS`)

Muốn nạp qua `EXTRA_PLUGINS` mà không sửa source agent-core — 1 trong 3 template trên CHÍNH LÀ toàn bộ code cần, chỉ cần thêm `package.json`:

```
my-plugin/
├── package.json
└── index.ts
```

```json
{
  "name": "@myorg/agent-core-plugin-my-tool",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1"
  }
}
```

Chưa publish, muốn thử ngay tại chỗ:
```
EXTRA_PLUGINS=my-tool:./my-plugin/index.ts
```
Đã publish lên npm:
```
EXTRA_PLUGINS=my-tool:@myorg/agent-core-plugin-my-tool
EXTRA_PLUGIN_CONFIG__my-tool={"apiKey":"..."}
```

## 5. Test mẫu — mount Cordis thật, không mock

```ts
// tests/my-plugin.test.ts
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import * as myPlugin from '../index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('my-plugin', () => {
  it('đăng ký đúng tool, handler chạy đúng', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    await settle()

    root.plugin(myPlugin, { greeting: 'chào' })
    await settle()

    expect(root.tools.has('my_tool')).toBe(true)
    const result = await root.tools.invoke('my_tool', { input: 'x' }, { sessionId: 's1', source: 'default-loop' })
    expect(result).toEqual({ echoed: 'x', sessionId: 's1' })
  })

  it('unload fiber -> tool tự gỡ đăng ký (spatial composability)', async () => {
    const root = new Context()
    root.plugin(toolRegistry)
    await settle()

    const fiber = root.plugin(myPlugin)
    await settle()
    expect(root.tools.has('my_tool')).toBe(true)

    await fiber.dispose()
    expect(root.tools.has('my_tool')).toBe(false)
  })
})
```

## 6. Checklist trước khi coi là xong

- [ ] `apply` (hoặc `default`) export đúng 1 trong 2, không cả hai.
- [ ] Tool/provider chạm tài nguyên ngoài → check `ctx.permission` trước khi chạy (coding rule B1).
- [ ] Handler tool đọc `toolContext.sessionId`, KHÔNG tin `args.sessionId` model tự truyền (coding rule B1, Finding A1).
- [ ] State cần dọn khi unload → bọc qua `ctx.effect()`, không phải constructor trần.
- [ ] `npm run typecheck` sạch, có ít nhất 1 test mount Cordis thật (không mock `ctx`).
- [ ] Nội bộ (`bundles/`) → thêm dòng `mount(...)` vào `src/serve.ts`. Bên ngoài → set `EXTRA_PLUGINS`, xác nhận qua `GET /plugins` (category `external`, state `active`) rồi thử thật qua 1 turn chat.
