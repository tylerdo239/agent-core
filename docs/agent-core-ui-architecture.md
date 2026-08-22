# agent-core Web UI — kiến trúc package

Doc tham chiếu cho cách chia package của Web UI (`apps/web` + `packages/ui-*`),
viết ra ở phase restructure UI mirror cấu trúc thật của dsh
(`deepseek-harness/packages/client/`). Đây là nguồn tham chiếu lâu dài — thêm
package UI mới thì follow đúng quy ước ở đây, không tự chế quy ước khác.

## Bối cảnh / quyết định phạm vi

dsh thật chia UI thành ~15+ package dưới `packages/client/` (`ui-sidebar`,
`ui-layout`, `ui-conversation`, `ui-settings-general`, `ui-theme`,
`ui-primitives`, `ui-slots`, `web-react`...), mỗi package tự khai `inject`
(danh sách service cần) + `apply(ctx)` (đăng ký chính nó), và 1 hệ thống
riêng (`modules` + `runtime`) **tự quét** field `dsh.client` trong
`package.json` của từng package rồi tự nối chúng lại — về bản chất là 1
Cordis-like runtime THỨ HAI chạy trong trình duyệt (tách biệt hoàn toàn với
Cordis server-side).

**Quyết định (đã hỏi trực tiếp user trước khi làm):** agent-core chỉ mirror
**ranh giới package** (mỗi UI feature là 1 package riêng, cùng quy ước đặt
tên/cấu trúc file) — KHÔNG xây hệ thống module/DI tự quét như trên. Lý do:
hệ đó là 1 dự án hạ tầng MỚI, độ lớn tương đương xây lại 1 phần Cordis cho
trình duyệt — không tương xứng quy mô hiện tại (agent-core chỉ có ĐÚNG 1
consumer là `apps/web`, không có nhiều app dùng chung UI như dsh có
CLI/desktop/web/VS Code extension). `apps/web/src/App.tsx` vẫn compose các
package TƯỜNG MINH (tự import từng cái) — đúng tinh thần agent-core đã áp
dụng cho backend: `src/serve.ts` tự `root.plugin(...)` từng bundle, không
auto-discover qua quét thư mục (coding rule A16).

## Cấu trúc package hiện tại

```
packages/
├── ui-theme/             Token 3 tầng (static→alias→specific) — packages/ui-theme/src/tokens.css
├── ui-primitives/        Button, Modal, Tooltip, Toast, Pill, StateDot, SourceList, Skeleton
├── ui-slots/             Slot-registry thuần (SlotCore, không phụ thuộc React) — cơ chế UI-plugin THẬT
├── ui-react/             RenderSlot, SlotErrorBoundary — React binding cho ui-slots
├── ui-tool-web-search/   Ví dụ UI-plugin: đăng ký vào slot 'tool.call.toolview' cho tool web_search
├── ui-sidebar/           Sidebar, SearchModal, sessionHistory (localStorage), sidebarState (collapse)
├── ui-layout/            AppFrame — shell thuần (sidebar/header/main/footer slot), KHÔNG chứa nội dung app-specific
├── ui-conversation/      MessageBubble, Composer, ToolRow, GenericToolCard, EmptyState, AssistantMarkdown, StreamingRow
└── ui-settings-general/  SettingsForm (form REST/WS URL + API key), settings.ts (load/save/default)

apps/web/
└── src/App.tsx   Compose gốc — WS/session state (connect/applyStep/reconstructItems/handleSubmit) + import
                  từng package trên qua bare specifier `@agent-core/ui-*`, dựng <AppFrame sidebar=... header=... footer=...>
```

## Sơ đồ phụ thuộc giữa các package

```
ui-theme  (không phụ thuộc gì trong monorepo)
   ↑
ui-primitives  (phụ thuộc ui-theme)
   ↑                  ↑                    ↑                       ↑
ui-sidebar      ui-layout            ui-conversation        ui-settings-general
(+ lucide-react) (chỉ ui-theme,      (+ ui-slots,           (chỉ ui-primitives/
                 KHÔNG ui-primitives  + lucide-react,        ui-theme)
                 — shell không có     + react-markdown)
                 control tương tác)
   ↑                  ↑                    ↑                       ↑
                        apps/web (compose tất cả, giữ WS/session state)

ui-slots ← ui-react (React binding), ui-tool-web-search (ví dụ plugin, đăng ký vào ui-slots)
```

## Quy ước scaffold 1 package UI mới

Mọi package `packages/ui-<name>` mới tạo đúng hình dạng sau (khớp
`packages/ui-primitives` — package đầu tiên theo mẫu này):

```
packages/ui-<name>/
├── package.json         name: "@agent-core/ui-<name>", "main": "src/index.ts",
│                        dependencies chỉ liệt kê package/thư viện THẬT SỰ dùng
├── src/
│   ├── css-modules.d.ts     ambient declaration cho *.module.css (copy y nguyên từ package khác)
│   ├── index.ts              barrel export — mọi component/type public đi qua đây
│   ├── Name.tsx               component
│   └── Name.module.css        style scoped CSS Modules
└── tests/
    └── Name.test.tsx          test thật (render/interact/assert), không phải chỉ tin "build xanh"
```

Sau khi tạo `package.json` mới: chạy `npm install` NGAY (tạo symlink
`node_modules/@agent-core/<name>`) trước khi import bằng bare specifier ở
bất kỳ đâu — thiếu bước này ra lỗi "cannot find module" trông như bug code
nhưng thực ra chỉ là thiếu symlink.

**Không dùng** hậu tố `*.client.spec.tsx` như dsh — quy ước test hiện tại
của agent-core (`Name.test.tsx`/`name.test.ts`) đã nhất quán xuyên suốt
project, đổi riêng cho package mới sẽ tạo 2 quy ước song song không cần
thiết.

## Docker: 1 lưu ý bắt buộc khi thêm package mới

`Dockerfile` stage `deps` `COPY` từng `package.json` của workspace member
RIÊNG LẺ trước `npm ci` (không phải copy cả `packages/` — để tận dụng layer
cache đúng, sửa source không làm cache miss, chỉ `package.json` đổi mới
miss). Thêm 1 package mới **bắt buộc** thêm 1 dòng
`COPY packages/ui-<name>/package.json ./packages/ui-<name>/package.json`
vào đúng stage đó — thiếu dòng này `npm ci` trong Docker build sẽ không
thấy package mới dù `npm install` ở máy dev vẫn chạy bình thường (2 môi
trường khác nhau, lỗi chỉ lộ ra khi build image thật).

## Việc KHÔNG làm (chủ động, không phải bỏ sót)

- **Không xây hệ module/DI tự quét cho client** (xem "Quyết định phạm vi" ở
  trên) — nếu sau này thật sự cần (vd. có thêm 1 consumer app thứ 2 dùng lại
  UI này), đây là chỗ cần thiết kế lại, không phải mở rộng dần từ cấu trúc
  hiện tại.
- **Không tách state/orchestration của conversation** (`connect`,
  `applyStep`, `reconstructItems`, `handleSubmit`, state `ChatItem[]`) ra
  khỏi `apps/web/src/App.tsx` thành 1 "controller" riêng như
  `ConversationController` thật của dsh — cần thiết kế API prop/callback
  xuyên suốt sidebar/settings/conversation, không có lợi ích thật khi vẫn
  chỉ có 1 consumer, 1 conversation view duy nhất.
