# Quy trình build 1 UI-plugin cho agent-core (Phase 9: `ctx.slots`)

> **Điều kiện tiên quyết**: doc này mô tả quy trình cho kiến trúc Phase 9
> (`ctx.slots`, `packages/ui-slots`, `apps/web` React) — xem thiết kế đầy đủ
> + lý do kiến trúc trong
> [`agent-core-cordis-build-plan.md`](./agent-core-cordis-build-plan.md#phase-9)
> và rule A15/A16 trong
> [`agent-core-cordis-coding-rules.md`](./agent-core-cordis-coding-rules.md).
> **Nếu Phase 9 chưa được build trong repo bạn đang cầm** (kiểm nhanh:
> `packages/ui-slots` có tồn tại không), tool của bạn chỉ cần khai
> `ToolDefinition.ui` (Phase 8.5, xem `seams/tools.ts`) — không có gì khác để
> làm, dừng ở đây.

## 1. Khi nào cần viết UI-plugin riêng — và khi nào KHÔNG cần

Không phải tool nào cũng cần. `GenericToolCard` (built-in trong `apps/web`,
đọc `ToolDefinition.ui` — icon/label/render-kind `'citations'|'io'`) đã đủ
cho phần lớn tool: tool trả JSON đơn giản, danh sách nguồn, hoặc bất kỳ dữ
liệu nào hiển thị tốt bằng card IN/OUT chung. **Mặc định: chỉ khai `ui` (Phase
8.5), không viết UI-plugin.**

Viết UI-plugin riêng khi có ít nhất 1 trong các lý do thật sau:
- Cần **tương tác** (nút bấm, expand từng phần tử riêng, filter, sort) —
  `GenericToolCard` chỉ hiển thị tĩnh.
- Cần **hiển thị đặc thù không rơi vào 2 kiểu `citations`/`io`** (biểu đồ, sơ
  đồ, preview file, diff code...).
- Cần **state cục bộ** sống qua nhiều lần re-render (vd. toggle "xem thêm",
  vị trí cuộn riêng).

Nếu không chắc, **bắt đầu bằng `ui` metadata trước** — nâng cấp lên
UI-plugin sau khi thấy `GenericToolCard` thật sự không đủ, không viết trước
khi có nhu cầu thật (coding rule A6, áp dụng cả ở tầng UI).

## 2. Luồng dữ liệu đầy đủ (biết trước khi viết, để hiểu vì sao mỗi bước cần)

```
bundles/tools/<tool>/index.ts        khai báo tool + ToolDefinition.ui (Phase 8.5, VẪN CẦN dù có UI-plugin)
        │  ctx.tools.add({ name: 'web_search', ui: {...}, handler })
        ▼
loop-default / loop-planner-critic   tra tool.ui, gắn vào LoopStep.toolUi khi emit 'agent/step'
        ▼
WS ("step" message) / gRPC (tool_ui_json)   forward nguyên vẹn, không xử lý gì thêm
        ▼
apps/web (client Cordis tree, chạy TRONG TRÌNH DUYỆT — cây Context RIÊNG,
          không liên quan cây root của src/serve.ts)
        │  App.tsx nhận step qua WS, gọi:
        │  <RenderSlot ctx={clientCtx} name="tool.call.toolview"
        │              entryKey={toolCall.name} owner={ownerProps}
        │              fallback={GenericToolCard} />
        ▼
ctx.slots.entries('tool.call.toolview')   tìm entry có key === toolCall.name
        │
   có UI-plugin đăng ký key đó?
   ├─ CÓ  → render component của UI-plugin (packages/ui-tool-<ten>/)
   └─ KHÔNG → render GenericToolCard (đọc lại toolUi.icon/label/render)
```

`key` ở bước `ctx.slots.register(..., { key })` **phải khớp tuyệt đối** với
`ToolDefinition.name` ở bước đầu tiên — đây là chỗ dễ sai nhất và **compiler
không báo lỗi gì cả** (2 chuỗi lệch nhau 1 ký tự → UI-plugin của bạn không
bao giờ được gọi, tool âm thầm rơi về `GenericToolCard`, không có exception,
không có log — verify bằng test, đừng tin bằng mắt).

## 3. Các bước cụ thể

### Bước 1 — Xác nhận tool đã có `ui` metadata (Phase 8.5)

```typescript
// bundles/tools/<ten-tool>/index.ts (đã tồn tại, chỉ cần XÁC NHẬN có ui)
ctx.tools.add({
  name: 'web_search', // ← đây là "key" bạn sẽ dùng lại y hệt ở Bước 4
  description: '...',
  ui: { icon: '🔍', label: 'Tìm kiếm web', render: 'citations' }, // fallback vẫn cần, không xoá khi thêm UI-plugin
  handler: async (args) => {...},
})
```

### Bước 2 — Tạo package `packages/ui-tool-<ten-tool>/`

```
packages/ui-tool-<ten-tool>/
├── package.json          (xem template Bước 5 — KHÔNG cần tsconfig.json
│                           riêng, root tsconfig.json đã include "packages")
├── src/
│   ├── index.ts           (apply/inject — đăng ký vào ctx.slots)
│   ├── <Ten>Card.tsx       (component React thật)
│   └── <Ten>Card.css       (tuỳ chọn — CSS riêng của UI-plugin, dùng lại
│                            design token khai ở apps/web/src/style.css :root)
└── tests/
    └── index.test.tsx
```

### Bước 3 — Viết component nhận đúng `ToolViewOwnerProps`

Component KHÔNG tự gọi network, KHÔNG tự đọc `localStorage`/API key riêng —
mọi dữ liệu nó cần đã có trong `owner` props (`toolCall`, `result`, `state`).
Đây là "adapter không chứa business logic" áp dụng ở tầng UI — component chỉ
hiển thị dữ liệu đã có, không tạo thêm 1 nguồn sự thật khác.

### Bước 4 — Đăng ký vào `ctx.slots` (rule A15)

```typescript
// packages/ui-tool-<ten-tool>/src/index.ts
export const inject = ['slots']
export const apply = (ctx: Context) => {
  ctx.effect(() => ctx.slots.register('tool.call.toolview', {
    key: 'web_search', // TRÙNG TUYỆT ĐỐI với ToolDefinition.name ở Bước 1
    component: WebSearchCard,
    registrant: 'ui-tool-web-search',
  }))
}
```

### Bước 5 — Mount tường minh vào `apps/web` (rule A16)

```typescript
// apps/web/src/client-context.ts — thêm 2 dòng, KHÔNG có cơ chế tự quét
import * as uiToolWebSearch from '@agent-core/ui-tool-web-search'
// ...
await ctx.plugin(uiToolWebSearch)
```

Quên bước này = package build đúng, test đơn vị pass, nhưng UI-plugin
**không bao giờ chạy trong app thật** — không có gì báo lỗi, vì đây đúng là
hành vi hợp lệ (dsh cũng vậy: đăng ký = registrant chủ động khai, không phải
nghĩa vụ tự động). Luôn verify bằng cách mở app thật, không chỉ tin build
xanh.

### Bước 6 — Viết test

Tối thiểu 3 case (dùng `@testing-library/react`, cùng pattern
`packages/ui-react` deliverable 9.3):
1. UI-plugin đã mount → tool call đúng `key` → render đúng component của bạn.
2. UI-plugin CHƯA mount (hoặc key không khớp) → render `GenericToolCard`
   (fallback), không throw.
3. Unmount fiber UI-plugin lúc app đang chạy (mô phỏng hot-swap) → UI tự
   chuyển về fallback, không cần reload trang.

## 4. Rule bắt buộc (tóm tắt — xem A15/A16 để biết lý do đầy đủ)

1. `key` phải khớp `ToolDefinition.name` tuyệt đối — verify bằng test, không
   bằng mắt.
2. Disposer từ `ctx.slots.register()` LUÔN bọc qua `ctx.effect()` (A15).
3. Component không được throw ra ngoài lúc render — dữ liệu `result` từ tool
   là JSON tuỳ ý (tool có thể trả lỗi/thiếu field), validate trước khi
   destructure, không giả định shape luôn đúng.
4. Component không tự gọi network/API riêng ngoài dữ liệu đã có trong props.
5. Không tự đọc `localStorage`/API key riêng trong component — nếu cần
   identity gì, nhận qua props/ctx từ `apps/web`, tránh phân mảnh nguồn sự
   thật (đã có 1 chỗ quản lý settings/API key trong `apps/web`, không tạo
   chỗ thứ 2).
6. `ToolDefinition.ui` (Phase 8.5) **vẫn phải khai** dù đã có UI-plugin riêng
   — đây là nguồn icon/label lúc `GenericToolCard` hiển thị tạm trong lúc
   UI-plugin package chưa build xong/bị lỗi, không phải phần thừa để xoá.

## 5. Template đầy đủ

```json
// packages/ui-tool-<ten-tool>/package.json
{
  "name": "@agent-core/ui-tool-<ten-tool>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@agent-core/ui-slots": "*",
    "@deepseek-ai/cordis": "4.0.1",
    "react": "^18.3.1"
  }
}
```

**LƯU Ý (phát hiện thật khi build `packages/ui-tool-web-search`, Phase 9.5):**
`"workspace:*"` là cú pháp version specifier của **pnpm/yarn**, KHÔNG hợp lệ
với npm — repo này dùng npm workspaces (Phase 9.6, quyết định có chủ đích,
xem build plan Phase 9.6), nên package nội bộ khác trong cùng workspace ghi
`"*"` (khớp mọi version, npm tự resolve qua symlink `node_modules/@agent-core/
<ten>` thay vì tải từ registry). Ghi `"workspace:*"` ở đây sẽ làm `npm
install`/`npm ci` lỗi thẳng — không phải chi tiết vô hại.

```typescript
// packages/ui-tool-<ten-tool>/src/<Ten>Card.tsx
import type { ToolViewOwnerProps } from '@agent-core/ui-slots'

export function <Ten>Card({ toolCall, result, state }: ToolViewOwnerProps) {
  if (state === 'running') return <div className="tool-card-running">Đang chạy...</div>
  if (state === 'error') return <div className="tool-card-error">{String((result as any)?.error ?? 'Lỗi')}</div>

  // Validate shape trước khi dùng — result là JSON tuỳ ý từ tool, không giả
  // định field nào chắc chắn tồn tại (rule 3 ở mục 4).
  const items = Array.isArray((result as any)?.results) ? (result as any).results : []

  return (
    <ol className="tool-card-list">
      {items.map((item: any, i: number) => (
        <li key={i}>{String(item.title ?? item.url ?? '')}</li>
      ))}
    </ol>
  )
}
```

```typescript
// packages/ui-tool-<ten-tool>/src/index.ts
import { Context } from '@deepseek-ai/cordis'
import '@agent-core/ui-slots'
import { <Ten>Card } from './<Ten>Card.tsx'

export const inject = ['slots']

export const apply = (ctx: Context) => {
  ctx.effect(() => ctx.slots.register('tool.call.toolview', {
    key: '<ten-tool-dung-wire-name>',
    component: <Ten>Card,
    registrant: 'ui-tool-<ten-tool>',
  }))
}
```

```typescript
// packages/ui-tool-<ten-tool>/tests/register.client.spec.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import * as uiSlots from '@agent-core/ui-slots'
import { RenderSlot } from '@agent-core/ui-react'
import * as thisPlugin from '../src/index.ts'

function GenericFallback() { return <div data-testid="fallback" /> }

describe('ui-tool-<ten-tool>', () => {
  it('đăng ký đúng key, render component riêng thay vì fallback', async () => {
    const ctx = new Context()
    await ctx.plugin(uiSlots)
    ctx.slots.declare('tool.call.toolview', 'keyed')
    const fiber = ctx.plugin(thisPlugin)
    await fiber.await()

    const view = render(
      <RenderSlot ctx={ctx} name="tool.call.toolview" entryKey="<ten-tool-dung-wire-name>"
        owner={{ toolCall: { name: '<ten-tool-dung-wire-name>', args: {} }, result: { results: [] }, state: 'ok' }}
        fallback={GenericFallback} />,
    )
    expect(view.queryByTestId('fallback')).toBeNull()

    // Unmount UI-plugin -> phải rơi về fallback, không throw (mô phỏng hot-swap).
    await fiber.dispose()
    view.rerender(
      <RenderSlot ctx={ctx} name="tool.call.toolview" entryKey="<ten-tool-dung-wire-name>"
        owner={{ toolCall: { name: '<ten-tool-dung-wire-name>', args: {} }, result: {}, state: 'ok' }}
        fallback={GenericFallback} />,
    )
    expect(view.queryByTestId('fallback')).not.toBeNull()
  })
})
```

## 6. Checklist trước khi coi UI-plugin là xong

- [ ] `key` khớp tuyệt đối `ToolDefinition.name` (Bước 1 + 4) — verify bằng test, không bằng mắt
- [ ] `ToolDefinition.ui` vẫn khai (không xoá khi thêm UI-plugin)
- [ ] Disposer bọc qua `ctx.effect()` (A15)
- [ ] Mount tường minh trong `apps/web/src/client-context.ts` (A16) — đã verify bằng cách MỞ APP THẬT, không chỉ tin test đơn vị
- [ ] Component không throw khi `result` thiếu field/sai shape
- [ ] Component không tự gọi network/localStorage riêng
- [ ] Test: đăng ký đúng dispatch, fallback khi không khớp, fallback khi unmount (hot-swap)
