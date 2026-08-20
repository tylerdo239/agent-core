# agent-core

Core agent trên `@deepseek-ai/cordis@4.0.1`, build theo
[`docs/agent-core-cordis-build-plan.md`](../docs/agent-core-cordis-build-plan.md)
và [`docs/agent-core-cordis-coding-rules.md`](../docs/agent-core-cordis-coding-rules.md).

**Trạng thái: Phase 0–15 xong (toàn bộ) — 117/117 test pass thật, 26 file
test.** Core + production hardening (auth, giới hạn request, process
resilience, session/history/storage lifecycle, LLM retry) + Web UI React
thật (Phase 9, `apps/web`, slot-registry `ctx.slots` kiểu dsh — parity cấu
trúc, không phải metadata) + **design-system + rebrand cam/trắng/đen (Phase
10)**: token màu 3 tầng port đúng kiến trúc dsh (`packages/ui-theme`), bảng
màu chủ đạo cam `#F26F21` / nền trắng `#fff` / chữ đen `#222222`; `Button`
dạng viên thuốc (CSS Modules — lần đầu repo dùng, thay global CSS); bubble
tin nhắn user đúng hình học dsh (`border-radius: 22px`); tin nhắn assistant
đổi từ bubble sang **full-width + markdown thật** (`react-markdown`, sửa
đúng 1 gap có sẵn từ Phase 7: model trả lời có markdown thật nhưng UI cũ
hiện nguyên `**`/`*` thô) + Docker (3-stage build, `apps/web/dist` build qua
Vite ngay trong image). `npm run serve` + `docker compose up` phục vụ UI
React + theme mới tại port 8790 — **đã verify end-to-end qua WS thật với
LLM/search thật trong Docker, CSS build ra chứa đúng `#f26f21` +
`border-radius:22px`**, nhưng **CHƯA có ai xác nhận bằng mắt qua trình
duyệt thật** (môi trường build không có trình duyệt) — nên tự mở
`http://localhost:8790` sau khi deploy để chắc trước khi coi là xong hoàn
toàn. `bundles/adapters/web-ui/public/{index.html,app.js,style.css}` (Phase
7, bản vanilla JS cũ) giờ là file mồ côi (không còn code nào đọc) — CHỦ ĐỘNG
CHƯA XOÁ vì repo này không phải git repository, xoá sẽ không khôi phục
được nếu UI mới có vấn đề — xoá sau khi xác nhận UI mới ổn qua trình duyệt.
**Phase 11 (audit fix, đối chiếu `docs/agent-core-master-summary.md`)**: 2
gap thật đã sửa — `tool-web-search` giờ có timeout cho `fetch()` (trước đây
có thể treo cả turn vô thời hạn), `RenderSlot` giờ có Error Boundary (trước
đây 1 UI-plugin throw lúc render sẽ crash trắng toàn bộ trang, không chỉ 1
tool-row). **Phase 12**: `packages/ui-primitives` — bộ component design-
system dùng chung mới (`Modal`, `Tooltip`, `Toast`, `Pill`, `StateDot`) +
chuyển `Button` từ `apps/web` sang package này (để `packages/ui-tool-web-
search` dùng lại được, không còn phải tự viết `<button>` thô) — CHỈ phần
thật sự áp dụng được cho 1 chat UI đơn cột, không clone phần feature-specific
của dsh (job management, sidebar nhiều panel... — agent-core không có tính
năng tương ứng). **Phase 13**: layout đổi sang 2 cột — sidebar (lịch sử
session, lưu client-side qua `localStorage`, KHÔNG có `GET /sessions` server-
side để tránh rò rỉ chéo giữa các API key dùng chung) + khung chat chính
(`apps/web/src/Sidebar.tsx`); resume 1 session cũ qua `GET /sessions/:id/
events` rồi dựng lại `ChatItem[]`. Phát hiện + sửa **2 gap backend thật**
trong lúc build: (1) tin nhắn user chưa từng được lưu `storage.appendEvent`
(chỉ model/tool/critic) — sửa ở `AgentRunner.runTurn()`, entrypoint ổn định
duy nhất cho mọi driver; (2) `toolUi` chỉ phát qua `agent/step` live, chưa
lưu storage — resume sẽ mất icon/label/citation của tool cũ — sửa ở cả
`loop-default` và `loop-planner-critic`. 4 test cũ cập nhật theo sequence
event mới (hành vi cố ý đổi, không phải regression), 8 test mới cho
`sessionHistory.ts`. **Phase 14**: sidebar giờ thu gọn được (co lại thành
1 rail icon-only ~56px, KHÔNG ẩn hẳn — pattern lấy cảm hứng từ
`SidebarRoot` thật của dsh, đọc trực tiếp source first-party có sẵn trên
máy dev để nắm đúng pattern rồi viết lại 100% code mới bằng token/component
riêng của agent-core, không copy nguyên JSX/CSS gốc), list lịch sử được
polish (border-radius + transition mượt hơn cho hover/active), và nút bánh
răng trong header đã **gỡ hẳn**, thay bằng 1 hàng "Cấu hình" cố định cuối
sidebar (đúng vị trí "Settings trigger" thật của dsh — không phải avatar/
profile vì app này không có tài khoản người dùng thật). **Phase 15**: audit
user hỏi "skill"/"memory" đâu, storage production-ready chưa — trả lời:
skill chưa từng tồn tại (khác memory, không phải bị bỏ sót), memory có
interface nhưng chưa có provider (vẫn ngoài phạm vi, README có ghi rõ),
storage có 2 gap thật đã sửa (thiếu index trên `session_id`, chưa bật WAL).
Build mới: **seam `ctx.skills`** (`seams/skill.ts`) — khác `ctx.tools`/
`ctx.subagents`, "skill" là gói hướng dẫn TĨNH nạp có điều kiện vào system
prompt khi trigger khớp tin nhắn user, không phải hàm gọi được — provider
`providers/skill-registry` + ví dụ `skills/skill-support-tone` (kích hoạt
khi user báo lỗi/khiếu nại, chèn hướng dẫn giọng văn hỗ trợ 3 bước). Nối
thật vào `loop-default`/`loop-planner-critic` qua `Session.buildPrompt()`
(seams/loop.ts) — verify bằng LLM thật trong Docker: câu trả lời model đúng
cấu trúc skill yêu cầu khi trigger khớp. Chi tiết đầy đủ
từng phase 9.1-15 (kể cả các bug/gap thật phát hiện lúc implement) xem
[`docs/agent-core-cordis-build-plan.md`](../docs/agent-core-cordis-build-plan.md#phase-9)
và quy trình build 1 UI-plugin trong
[`docs/ui-plugin-build-guide.md`](../docs/ui-plugin-build-guide.md). Phần
"chưa build" khác (memory/sandbox provider, tool Python qua MCP, đa-instance)
chưa từng là deliverable bắt buộc, hoặc chủ động chưa cần — xem mục "Ngoài
phạm vi" cuối file.

## Chạy thử

```bash
npm install
npm run dev        # Phase 0 sanity-check.ts
npm test           # toàn bộ test suite (117 test, Phase 0/2/3/4/5/6/7/8/9/10/11/12/13/14/15) — pretest tự "npm run build:web"
npm run typecheck  # tsc --noEmit, phải sạch với 0 provider mount

# Chạy backend + Web UI React thật (REST :8787, WS :8788, gRPC :50051, UI :8790):
npm run build:web   # bắt buộc trước lần chạy đầu (hoặc sau khi sửa apps/web) — bundles/adapters/web-ui serve apps/web/dist, không tự build
OPENAI_API_KEY=sk-... OPENAI_BASE_URL=... OPENAI_MODEL_ID=... API_KEYS=key1,key2 npm run serve
# Thiếu 1 trong 4 biến trên -> exit(1) ngay với lỗi rõ ràng, không boot nửa vời
# (OPENAI_BASE_URL/OPENAI_MODEL_ID không có default cứng trong code — cố ý).
# Mở http://localhost:8790, nhập API_KEYS ở ⚙ lúc đầu, chat luôn.

# Dev nhanh cho riêng UI (hot reload, không cần build:web lại mỗi lần sửa):
npm run dev:web     # Vite dev server tại http://localhost:5173, gọi thẳng REST/WS thật (npm run serve chạy song song)

# Hoặc bằng Docker (xem mục "Docker" cuối file):
cp .env.example .env   # điền OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL_ID, API_KEYS thật
docker compose up --build
```

## Cấu trúc

```
seams/      Phase 1 + 6 + 15 — interface thuần (llm, storage, memory, tools, permission, sandbox, subagents, skill, loop, agent, sessions)
bundles/    Phase 2-6 — provider cho từng seam + spatial composability + agent loop + hot-swap + REST/WS/gRPC
tests/      test tự động cho từng deliverable (không phải chạy tay rồi tin)
src/        sanity-check.ts (Phase 0), serve.ts (boot backend thật)
```

`bundles/` chia 5 folder con theo **loại artefact**, không phải theo phase
(1 bundle có thể tồn tại đè lên nhiều phase, vd. `tool-registry` dùng lại
xuyên suốt Phase 2-6) và không phải "ví dụ vs thật" (mọi bundle trong repo
đều là code thật, chạy được trong production — không có khái niệm "demo"):

```
bundles/
├── providers/     implement 1 seam cụ thể (ctx.<key> = instance thật) — 9 bundle
├── tools/         tool đăng ký vào ctx.tools (qua providers/tool-registry) — 2 bundle
├── subagents/     subagent đăng ký vào ctx.subagents — 1 bundle
├── skills/        skill đăng ký vào ctx.skills (qua providers/skill-registry) — 1 bundle
├── loop-drivers/  driver đăng ký vào ctx.loop — 2 bundle
└── adapters/      transport mỏng (REST/WS/gRPC), không chứa business logic — 3 bundle
```

Tool/subagent/loop-driver mới thêm sau này (production sẽ có nhiều hơn 2-3
cái) đi thẳng vào đúng folder loại của nó — không cần nghĩ "đây có phải ví
dụ không", vì không còn khái niệm đó.

| Bundle | Seam cung cấp | Ghi chú |
|---|---|---|
| `providers/tool-registry` | `ctx.tools` | không có sẵn từ Cordis — tự viết (khác dsh) |
| `providers/state-sqlite` | `ctx.storage` | SQLite thật qua `better-sqlite3`, lifecycle qua `[Service.init]`. Phase 8.4: `retentionDays` tuỳ chọn (KHÔNG set = không prune gì) — sweep định kỳ xoá event cũ hơn N ngày |
| `providers/permission-rbac` | `ctx.permission` | RBAC in-memory, deny-by-default |
| `providers/llm-qwen` | `ctx.llm` | **provider mặc định trong `serve.ts`** — wrap proxy OpenAI-compatible Qwen3.5 dùng thật ở repo `data-agent`, cần `OPENAI_API_KEY` — không dùng trong test tự động. Phase 8.3: retry với backoff cho lỗi transient (network/429/5xx), không retry 4xx khác |
| `providers/llm-deepseek` | `ctx.llm` | provider thay thế (không mount mặc định) — gọi REST thật (kể cả tool-calling), cần `DEEPSEEK_API_KEY` nếu dùng lại |
| `providers/subagent-manager` | `ctx.subagents` | không có sẵn từ Cordis — tự viết |
| `providers/skill-registry` | `ctx.skills` | seam mới thêm ở Phase 15 — khác `ctx.tools`/`ctx.subagents`: skill KHÔNG phải hàm gọi được, là gói hướng dẫn tĩnh nạp có điều kiện vào system prompt khi trigger khớp tin nhắn user (xem `seams/skill.ts`) |
| `providers/loop-registry` | `ctx.loop` | seam mới thêm ở Phase 4 (không có trong bảng Phase 1 gốc — xem `seams/loop.ts`) |
| `providers/agent-runner` | `ctx.agent` | seam mới thêm ở Phase 5 — entrypoint ổn định để chạy 1 turn, nơi "pin" driver (xem bên dưới) |
| `providers/session-registry` | `ctx.sessions` | seam mới thêm ở Phase 6 — nơi REST/WS/gRPC dùng chung để tạo/tra session. Phase 8.1: TTL trượt theo hoạt động (`get()` cập nhật `lastActiveAt`), sweep định kỳ xoá session bị bỏ quên |
| `providers/auth-apikey` | `ctx.auth` | production hardening — so khớp API key bằng constant-time compare (`crypto.timingSafeEqual`), tránh timing attack |
| `loop-drivers/loop-default` | — | `inject: ['loop']` — driver ReAct mặc định: model ↔ tool ↔ storage |
| `loop-drivers/loop-planner-critic` | — | `inject: ['loop']` — driver thứ 2, thêm 1 lượt "phê bình" trước khi chốt câu trả lời, đăng ký CÙNG tên `'default'` để swap có ý nghĩa |
| `adapters/api-rest` | — | `node:http` thuần, `inject: ['sessions','agent','storage','auth']`, giới hạn body 1 MiB, CORS bật mặc định (cho web-ui gọi cross-port) |
| `adapters/api-ws` | — | package `ws`, stream `agent/step` real-time, auth qua header (client Node) HOẶC `?key=` query string (browser thật — Web spec không cho set header lúc WS handshake), `maxPayload` 1 MiB |
| `adapters/api-grpc` | — | `@grpc/grpc-js` + `@grpc/proto-loader`, mirror REST + `StreamTurn` (server-streaming), auth qua metadata |
| `adapters/web-ui` | — | (Phase 7.1) không inject seam nào — chỉ serve static file, mọi logic (tạo session, gửi message, nhận stream) chạy ở browser (`public/app.js`), gọi thẳng REST/WS như client ngoài |
| `tools/tool-database-query` | — | `inject: ['storage', 'tools']` |
| `subagents/subagent-report-writer` | — | `inject: ['permission', 'llm', 'subagents']` |
| `tools/tool-web-search` | — | `inject: ['permission', 'tools']` |

## Phase 8 — Production hardening round 2 (session/history lifecycle, LLM retry, storage retention, UI plugin-driven)

Phát hiện qua audit production-readiness sau khi chạy thật bằng Docker một
thời gian — 4 gap chỉ lộ ra khi chạy dài hạn/nhiều request, không lộ trong
demo ngắn. Chi tiết đầy đủ (thiết kế, đánh đổi, test) xem Phase 8 trong
[`docs/agent-core-cordis-build-plan.md`](../docs/agent-core-cordis-build-plan.md)
và coding rule A14 mới trong
[`docs/agent-core-cordis-coding-rules.md`](../docs/agent-core-cordis-coding-rules.md).
Tóm tắt:

- **`session-registry`**: TTL trượt theo hoạt động (không sweep session đang
  chat liên tục) — trước đây giữ session vĩnh viễn, leak RAM trên deployment
  dài hạn.
- **`Session.history`**: sliding window (`maxHistoryMessages`, default 40) —
  trước đây gửi toàn bộ lịch sử mỗi turn, không giới hạn.
- **`llm-qwen`**: retry với backoff cho lỗi transient (network/429/5xx),
  không retry 4xx khác — trước đây 1 lỗi mạng thoáng qua fail thẳng cả turn.
- **`state-sqlite`**: retention theo thời gian, tuỳ chọn (`retentionDays`,
  KHÔNG set = không prune, backward compatible) — trước đây bảng `events`
  ghi mãi mãi.
- **UI plugin-driven (metadata, Phase 8.5)**: tool tự khai `ui` hint
  (`ToolDefinition.ui` trong `seams/tools.ts`) — thay vì hardcode theo tên
  tool (`if (name === 'web_search')`). **Đã lên Phase 9** (parity cấu trúc
  thật với dsh, `ctx.slots` — xem Phase 7 mới bên dưới); cơ chế `ui` metadata
  ở đây KHÔNG bị vứt bỏ — trở thành nguồn dữ liệu cho fallback
  `GenericToolCard` khi tool không có UI-plugin riêng.

## Phase 7/9 — Web UI (React thật, `apps/web`) + Docker

**Đã đổi từ vanilla JS (Phase 7 gốc) sang React thật (Phase 9)** — xem
[Phase 9 trong build plan](../docs/agent-core-cordis-build-plan.md#phase-9)
để biết đầy đủ thiết kế/bug thật phát hiện lúc build. Tóm tắt phần còn liên
quan trực tiếp tới chạy/deploy:

### Web UI

`apps/web` (Vite + React) build ra `apps/web/dist`, `bundles/adapters/web-ui`
serve đúng thư mục đó (KHÔNG tự build — chạy `npm run build:web` trước, xem
mục "Chạy thử"). Mở `http://localhost:8790`, lần đầu sẽ hỏi API key (⚙) —
lưu trong `localStorage` trình duyệt, không gửi đi đâu khác ngoài REST/WS URL
đã cấu hình. Gửi message thấy real-time đúng những gì `agent/step` phát ra:

- **Tool call** hiện thành 1 dòng thu gọn (icon + label + tóm tắt args),
  collapsed-by-default, sweep shimmer khi đang chạy, click để mở rộng —
  pattern dựa theo `ToolRow` thật của deepseek-harness (`apps/web/src/ToolRow.tsx`).
- **`web_search` có UI-plugin riêng thật** (`packages/ui-tool-web-search`,
  đăng ký qua `ctx.slots`) — không chỉ hiển thị tĩnh: toggle xem/ẩn snippet
  từng nguồn, nút "mở tất cả trong tab mới". Tool khác (`query_database`...)
  không có UI-plugin riêng → tự rơi về `GenericToolCard` (đọc `ToolUiHint`
  Phase 8.5), không crash trang.

**2 điểm kỹ thuật bắt buộc phải có để UI thật hoạt động** (không phải tuỳ
chọn — thiếu 1 trong 2 là UI không gọi được vào backend):

1. **CORS trên `api-rest`** — bật mặc định (`Access-Control-Allow-Origin: *`),
   an toàn vì auth dùng Bearer token (không phải cookie, không có rủi ro
   CSRF kiểu cookie-based). Override qua `config.corsOrigin` nếu cần khoá
   lại 1 origin cụ thể.
2. **`api-ws` nhận key qua query string** (`?key=...`) — trình duyệt thật
   dùng `new WebSocket(url)`, theo Web spec **không có** tham số set custom
   header, khác hẳn client Node package `ws` (dùng trong test, hỗ trợ
   `{ headers }`). Header vẫn được giữ song song cho client Node hiện có —
   không phải thay thế, là thêm đường cho browser.

### Docker

```bash
cp .env.example .env   # điền OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL_ID, API_KEYS thật — đổi API_KEYS mặc định trước khi deploy
docker compose up --build
```

`Dockerfile` build **3 stage** (Phase 9.6, trước đó 2 stage): `deps` có
`python3 make g++` (build native module `better-sqlite3` nếu không có
prebuilt binary khớp platform/arch) + cài đủ npm workspaces (copy
`package.json` của TỪNG workspace member trước `npm ci` — thiếu 1 cái là
`npm ci` fail, workspaces đòi khớp `package-lock.json`) → `build-web` (copy
`packages/`+`apps/web/`, chạy `npm run build:web` bằng Vite) → `runtime`
(copy `node_modules`+source server+**chỉ** `apps/web/dist` từ stage
`build-web` — không mang theo source phía client/toolchain build). Chạy bằng
user không phải root (`USER agent`). Server chạy bằng `tsx` (transpile lúc
chạy) — xem "Rủi ro" ở Phase 7.2 trong build plan để biết đánh đổi so với
build `tsc` sẵn ra `dist/`; Web UI THÌ build thật qua Vite (bắt buộc, không
gửi TypeScript thô cho trình duyệt được).

`docker-compose.yml`: map đủ 4 port (REST/WS/gRPC/Web UI), volume
`agent-core-data` cho `/app/data` (SQLite persist qua restart — đã verify
thật: build image thật, chạy thật, `curl` từ host, restart container, xác
nhận file `.db` còn nguyên trên volume), healthcheck gọi `/health` mỗi 15s.

**Đã verify toàn bộ bằng `docker compose build` + `up` + `curl` từ host
thật** (không phải chỉ viết Dockerfile rồi tin nó chạy) — health/ready/UI
(HTML/JS/CSS build từ Vite, content-type đúng)/tạo session có auth đều đúng
status code, container tự báo `healthy`, **và 1 turn chat thật qua WS** (hỏi
giá vàng → model gọi `web_search` thật → `toolUi` đúng key `web_search` →
câu trả lời thật dùng kết quả search thật) — chỉ chưa xác nhận bằng mắt qua
trình duyệt (môi trường build không có trình duyệt).

## Phase 6 — API layer: REST, WebSocket (stream), gRPC

Core (Phase 0-5) chỉ chạy in-process. Phase 6 bọc thành backend service thật
— 3 adapter mỏng dùng CHUNG 1 core (`ctx.sessions`/`ctx.agent`/`ctx.storage`),
không nhân bản business logic. Endpoint/protocol chi tiết xem
[`docs/agent-core-cordis-build-plan.md`](../docs/agent-core-cordis-build-plan.md)
Phase 6.

- **`seams/sessions.ts`** (`ctx.sessions`, provider `bundles/providers/session-registry`)
  — REST stateless-per-request, WS/gRPC long-lived connection, cả 3 cần 1 nơi
  DÙNG CHUNG để không mất đồng bộ session giữa các giao thức.
- **`agent/step`** (Cordis event, khai trong `seams/loop.ts`) — driver trong
  `bundles/loop-drivers/` phát NGAY TẠI ĐÚNG CHỖ đã ghi `storage.appendEvent`,
  không phải nguồn sự thật thứ 2. WS và gRPC `StreamTurn` đều nghe qua
  `ctx.on('agent/step', ...)`, lọc theo `sessionId`, forward ra client.
- **`bundles/adapters/api-rest`** — 4 endpoint (`POST /sessions`, `POST /sessions/:id/messages`,
  `GET /sessions/:id/events`, `GET /health`), `node:http` thuần.
- **`bundles/adapters/api-ws`** — giao thức JSON 2 chiều, `create_session`/`send_message`
  → stream `step` → `done`.
- **`bundles/adapters/api-grpc`** — `AgentService` (`CreateSession`, `SendMessage` unary,
  `StreamTurn` server-streaming), proto load runtime qua `@grpc/proto-loader`
  (không cần bước `protoc` codegen riêng).

Cả 3 adapter cùng lifecycle pattern (coding rule A13): `apply` là `async`,
tự mở server rồi `return` disposer trực tiếp — mount → unmount đóng cổng
sạch, có test xác nhận bằng client thật (fetch / `ws` / `@grpc/grpc-js`),
không mock transport ở bất kỳ đâu.

**2 bug thật phát hiện khi build Phase 6** (đã sửa + ghi thành coding rule,
không phải chỉ sửa cho qua):

1. **`apply` đồng bộ gọi `ctx.effect(async () => {...})` mà không await/return
   nó → fiber cha coi như "load xong" TRƯỚC KHI server thật sự listen.**
   `await fiber.await()` ở nơi gọi resolve sớm, đọc `config.port` chưa được
   gán. Verify thực nghiệm 2 lần (cho cả `ctx.effect()` không await lẫn
   `ctx.plugin(Class)` không await — bug tổng quát hơn dự kiến, ảnh hưởng cả
   8 bundle cũ tuy chưa lộ ra vì SQLite/RBAC init đồng bộ, không có I/O thật).
   Sửa toàn bộ 8 bundle cũ trong `bundles/providers/` (`state-sqlite`,
   `tool-registry`, `permission-rbac`, `llm-deepseek`, `subagent-manager`,
   `loop-registry`, `agent-runner`, `session-registry`) sang `async apply` +
   `await ctx.plugin(...)`. Coding rule A13.
2. **`fiber.await()` chỉ đợi công việc ĐANG CHẠY DỞ — nếu fiber vẫn PENDING
   (dependency của các bundle mount trước chưa kịp hội tụ), resolve ngay lập
   tức mà không đợi gì.** Gây 1 test REST flaky thật (`config.port` đọc được
   giá trị `0` chưa gán). Sửa bằng `await settle()` (1 tick timer thật) sau
   khi mount xong toàn bộ dependency graph, trước khi `fiber.await()` — ghi
   thành lưu ý trong coding rule A7.

## Production hardening

Build sau khi xác nhận: **API key đơn giản, 1 instance, mạng nội bộ** (không
Postgres/Redis — SQLite + session in-memory dùng được ngay ở quy mô này).

- **`seams/auth.ts` + `providers/auth-apikey`** — seam mới, so khớp API key
  bằng `crypto.timingSafeEqual` (không dùng `===`, tránh rò rỉ thời gian dò
  key). Cả 3 adapter đều `inject: [...,'auth']` và tự check ngay đầu mỗi
  request/handler — không có endpoint nào chạm `ctx.sessions`/`ctx.agent` mà
  chưa qua `ctx.auth.verify()` (đúng tinh thần coding rule B1).
  - REST: header `Authorization: Bearer <key>`, 401 nếu sai/thiếu. `/health`
    và `/ready` KHÔNG cần key (orchestrator/LB phải gọi được).
  - WS: check ngay lúc **handshake** (`verifyClient`) — từ chối bằng HTTP 401
    trước khi nâng cấp lên WebSocket, không phải accept-rồi-đóng.
  - gRPC: check qua metadata `authorization` ở đầu mỗi handler (unary +
    streaming) — gRPC không có middleware chuẩn đơn giản dùng chung được cho
    cả 2 kiểu RPC, check inline rõ ràng hơn tự chế interceptor.
- **Giới hạn kích thước request** — REST giới hạn body 1 MiB (`maxBodyBytes`,
  trả `413` nếu vượt), WS giới hạn 1 message qua `maxPayload`, gRPC giới hạn
  qua `grpc.max_receive_message_length` (mặc định 4 MiB). Không có giới hạn
  nào ở version trước — 1 request lớn có thể ăn hết RAM process.
- **`/ready` tách khỏi `/health`** (REST) — `/health` = process còn sống,
  `/ready` = `ctx.sessions`/`ctx.agent`/`ctx.storage` đã thật sự sẵn sàng
  (check qua `ctx.reflect.get(name, false)`). Orchestrator dùng `/ready` để
  quyết định có route traffic vào hay không.
- **`src/serve.ts` validate config lúc boot** — thiếu `OPENAI_API_KEY`,
  `OPENAI_BASE_URL`, `OPENAI_MODEL_ID` hoặc `API_KEYS` thì `exit(1)` ngay với
  lỗi rõ ràng, KHÔNG boot nửa vời rồi fail âm thầm sâu bên trong 1 fiber (đã
  gặp thật: thiếu `OPENAI_BASE_URL`/`OPENAI_MODEL_ID` làm `llm-qwen` throw
  trong `[Service.init]()`, nhưng lỗi đó không tự làm process exit — REST/WS/
  gRPC đứng yên ở PENDING mãi trong khi log vẫn in như đã chạy thành công;
  `requireEnv()` ở `serve.ts` chặn từ trước, không dựa 1 mình vào provider tự
  validate). Thêm `process.on('uncaughtException'/'unhandledRejection')`
  — lỗi không lường trước phải dừng process có kiểm soát, không chạy tiếp ở
  trạng thái không chắc còn đúng.

**Chưa build (chủ động, không phải bỏ sót)**: rate-limiting, CORS — độ ưu
tiên thấp hơn vì mạng nội bộ, không phải internet-facing. Nếu sau này đổi
sang expose public hoặc multi-instance, xem lại 2 câu hỏi đã chốt ở đầu mục
này trước khi build thêm.

## Phase 5 — chaos hot-swap

`tests/chaos-hot-swap.test.ts`: gỡ `loop-default`, mount `loop-planner-critic`
giữa lúc 1 turn khác (`session-1`) đang chạy dở bên trong 1 tool chạy lâu
(delay thật 60ms) — xác nhận cả 3 yêu cầu gốc cùng lúc, trên hệ thống "boot
đầy đủ":

- `session-1` hoàn tất **không lỗi**, dùng đúng driver **cũ** (không restart).
- `session-2` (tạo **sau** khi swap) dùng đúng driver **mới**.
- Lặp swap 5 vòng liên tiếp không leak; sau toàn bộ vòng, `llm`/`storage`/`tools`
  vẫn nguyên vẹn — hot-swap chỉ ảnh hưởng đúng phạm vi loop driver.

**Thay đổi kiến trúc bắt buộc để làm được điều này (không phải chỉ thêm test)**:
ban đầu `loop-default` tự đóng gói (closure) `ctx` từ `apply(ctx)` của chính
nó để gọi `ctx.llm`/`ctx.storage`/`ctx.tools` bên trong `runTurn`. Verify thực
nghiệm cho thấy: nếu fiber đăng ký driver đó bị dispose (hot-swap) trong lúc
1 turn khác vẫn đang chạy dở bằng driver đó, mọi lệnh gọi `ctx.*` tiếp theo từ
closure **throw** `"cannot get required service ... in inactive context"` —
dù `llm`/`storage`/`tools` vẫn đang sống bình thường ở nơi khác. Sửa bằng
cách:

1. `LoopDriver.runTurn` nhận `ctx` như **tham số tường minh** (`runTurn(runCtx, session, msg)`), không phải closure.
2. Thêm **seam `ctx.agent`** (`seams/agent.ts` + `bundles/providers/agent-runner`) — mount 1 lần, không phải mục tiêu hot-swap, tra driver từ `ctx.loop` **đúng 1 lần** lúc bắt đầu turn rồi pin tham chiếu đó cho suốt turn.
3. `loop-default`/`loop-planner-critic` giờ chỉ `inject: ['loop']` — không cần llm/storage/tools cho chính fiber đăng ký, vì logic thật chạy bằng `runCtx` do `agent-runner` truyền vào.

Đây là bài học kiến trúc thật, đã ghi thành **coding rule A12 [BLOCKING]**
trong `docs/agent-core-cordis-coding-rules.md` — không phải nhận xét suông.

## Phase 4 — agent loop

`bundles/loop-drivers/loop-default` implement đúng vòng ReAct đơn giản trong plan:
model → (quyết định gọi tool?) → chạy tool → ghi kết quả → lặp lại tới khi
model trả lời không kèm tool call, hoặc chạm `session.maxSteps`.

- **`seams/loop.ts`** định nghĩa `LoopRegistryService` (đăng ký driver theo
  tên — chỗ Phase 5 hot-swap `loop-default` ↔ `loop-planner-critic`) và
  `Session` — domain object giữ lịch sử hội thoại, **nơi duy nhất** ráp prompt
  (coding rule B6). `Session` KHÔNG phải service trên `ctx` — nó là state của
  1 cuộc hội thoại, không phải capability hệ thống, nên không cần spatial
  composability.
- Mỗi bước ghi `model_message` ngay sau khi model trả lời, và `tool_result`
  ngay sau khi tool chạy xong — **trước khi** qua bước kế tiếp (coding rule
  B3) — xem test `tests/agent-loop.test.ts` assert đúng thứ tự event.
- `llm-deepseek` nâng cấp để hỗ trợ tool-calling thật (`tools` param + parse
  `tool_calls` từ response DeepSeek/OpenAI-compatible) — nhưng đơn giản hoá
  có chủ đích: không track `tool_call_id` round-trip; message role `'tool'`
  được map thành `'user'` có tiền tố khi gửi lên API thật, để luôn là request
  hợp lệ mà không cần bookkeeping id (ghi rõ trong file, không âm thầm bỏ
  qua). Muốn function-calling multi-turn đúng chuẩn OpenAI thì đây là chỗ
  cần mở rộng trước.

## 3 cặp dependency đã có test spatial composability pass thật (Phase 3)

1. `tool-database-query` ↔ `storage`
2. `subagent-report-writer` ↔ `permission` + `llm` (dùng `FakeLlm` trong test — không gọi mạng thật)
3. `tool-web-search` ↔ `permission`

Cặp thứ 3 trong plan gốc (`loop ↔ llm`) được thay bằng `tool ↔ permission` vì
Phase 3 build TRƯỚC Phase 4 (loop chưa tồn tại lúc đó) — vẫn là 1 cặp
dependency thật trong hệ thống, đúng tinh thần "≥3 cặp thật" của deliverable
Phase 3, và minh hoạ đúng coding rule B1 (tool chạm tài nguyên ngoài phải tự
check permission). Cặp `loop ↔ llm` giờ ĐÃ có, ngầm định, trong mọi test ở
`tests/agent-loop.test.ts` và `tests/chaos-hot-swap.test.ts` (loop-default/
loop-planner-critic đều `inject: ['loop']` và gọi `runCtx.llm` — xem Phase 5).

## Sai lệch so với pseudocode trong build plan gốc (đã verify trên package thật, không phải suy đoán)

Trước khi viết bất kỳ file nào, đã cài `@deepseek-ai/cordis@4.0.1` thật và chạy
2 script xác thực độc lập (mount/unmount, spatial composability suspend/resume)
đối chiếu với source code thật của package. 4 điểm pseudocode trong plan gốc
KHÔNG khớp API thật:

1. **`Service` constructor chỉ nhận 2 tham số** — `super(ctx, name)`. Không có
   cờ `required` thứ 3 như plan viết (`super(ctx, 'storage', true)`). Mọi
   `inject` vốn đã là bắt buộc theo thiết kế (fiber ở trạng thái PENDING cho
   tới khi đủ dependency) — không cần cờ riêng.
2. **`Service` không có `start()`/`stop()` built-in.** Lifecycle thật: khi 1
   class kế thừa `Service` được dùng trực tiếp làm plugin
   (`ctx.plugin(SqliteStorage)`), Cordis gọi `new SqliteStorage(ctx, config)`
   rồi gọi `instance[Service.init]()` nếu có — giá trị trả về (1 hàm dispose,
   sync hoặc async) được đăng ký làm effect của đúng fiber sở hữu plugin đó.
   Xem `bundles/providers/state-sqlite/index.ts`.
3. **Không có `ctx.setInterval` trong core `@deepseek-ai/cordis`.** Đó là
   tính năng của package addon riêng (`@cordisjs/plugin-timer` trong bản
   OSS), chưa xác nhận có bản tương đương cho `@deepseek-ai/cordis`. Cách
   đúng theo core API: bọc side-effect bất kỳ (kể cả `setInterval` thô) qua
   `ctx.effect(() => { const id = setInterval(...); return () => clearInterval(id) })`.
4. **`export function apply(ctx) {...}` (function declaration) BỊ Cordis gọi
   bằng `new`** vì nó có `.prototype` (`isConstructor()` trả `true`) — nếu
   thân hàm `return` 1 disposer trực tiếp (không bọc qua `ctx.effect()`),
   disposer đó **bị nuốt mất trong im lặng**, không bao giờ chạy khi fiber
   dispose. Đã verify thực nghiệm (script so sánh named function vs arrow
   function). **Toàn bộ `apply` trong repo này dùng arrow function**
   (`export const apply = (ctx) => {...}`) để tránh bug này — xem coding
   rule A10 trong `docs/agent-core-cordis-coding-rules.md`.
5. **Arrow function expression-body (`ctx => ctx.plugin(X)`, không có `{ }`)
   cũng nguy hiểm theo hướng ngược lại** — phát hiện khi viết test Phase 4.
   Nó trả ngầm về Fiber handle (có `.then`), Cordis hiểu nhầm là 1 Effect cần
   await rồi collect, và khi resolve ra chính Fiber instance (không phải
   function/iterable hợp lệ) thì throw `TypeError: Invalid effect` — làm
   **cả fiber cha fail**, lan xa hơn nhiều so với chỗ gây ra lỗi. Luôn dùng
   block body `{ }` cho arrow function plugin — xem coding rule A11.
6. **Handler đăng ký vào 1 registry (loop driver, tool, subagent) không được
   tự đóng gói `ctx` của chính fiber đăng ký nó** — phát hiện khi build Phase
   5. Fiber đăng ký có thể bị dispose độc lập (hot-swap) trong lúc handler nó
   đăng ký vẫn đang chạy dở; `ctx.*` gọi tiếp từ closure đó sau khi fiber
   dispose sẽ throw `"inactive context"`, dù service vẫn sống ở nơi khác. Sửa
   bằng cách nhận `ctx` qua tham số tường minh từ 1 caller ổn định (xem
   `seams/agent.ts`) — coding rule A12.
7. **`apply` đồng bộ mở resource bất đồng bộ mà không await/return effect —
   fiber cha "load xong" trước khi resource thật sự sẵn sàng.** Phát hiện
   khi build Phase 6 (REST server chưa `listen()` xong mà fiber đã coi như
   active). Ảnh hưởng RỘNG hơn dự kiến — sửa cả 8 bundle Phase 2-5 cũ, không
   chỉ bundle mới. Coding rule A13. Xem mục Phase 6 phía trên để biết chi tiết.

Các phần còn lại của plan (seam pattern, `inject` là spatial composability,
`ctx.logger(name)`, effect tự rollback theo thứ tự ngược khi fiber dispose)
khớp đúng với package thật.

## Ngoài phạm vi (chưa build — không phải deliverable bắt buộc của phase nào)

- **`memory-vector`, `sandbox-local`/`sandbox-remote`**: `seams/memory.ts` và
  `seams/sandbox.ts` có interface (đúng Phase 1) nhưng chưa có provider. Plan
  gốc chỉ liệt kê 2 seam này trong bảng tham chiếu Phase 1, không yêu cầu
  provider ở deliverable của bất kỳ phase nào (0–5).
- **Tool Python qua MCP** (`@deepseek-ai/dsh-mcp-client`): Phase 4 trong plan
  gốc có nhắc tới nhưng không có test riêng bắt buộc; deliverable Phase 4
  thực tế đã đạt bằng tool in-process (`query_database`). Chưa build vì cần 1
  MCP server thật để verify — không muốn ship code tích hợp chưa test được
  (cùng kỷ luật đã áp dụng xuyên suốt: mọi API đều verify thực nghiệm trước
  khi viết, không suy đoán). Hạ tầng đã sẵn sàng nhận: bất kỳ tool nào (kể cả
  từ MCP) chỉ cần gọi `ctx.tools.add()` đúng seam `ToolDefinition`.
- **Auth: ĐÃ build** (API key, xem mục "Production hardening" phía trên) —
  không còn nằm trong danh sách này. JWT/mTLS/OAuth chỉ cần build nếu sau
  này có hệ thống user/login thật đứng trước, hoặc client là bên thứ 3 không
  tin tưởng được (khác giả định "API key nội bộ" đã chốt).
- **Multi-instance / scale ngang**: SQLite (file-based, single-writer) và
  `session-registry` (in-memory) chỉ đúng cho **1 instance duy nhất** — đã
  xác nhận đây là mô hình triển khai hiện tại nên KHÔNG build Postgres/Redis.
  Nếu sau này cần chạy nhiều instance sau load balancer: đổi `state-sqlite`
  → Postgres, `session-registry` → store dùng chung (Redis) — seam đã tách
  sẵn (`ctx.storage`/`ctx.sessions`), chỉ cần viết provider mới, không sửa
  business logic.
- **Rate limiting**: độ ưu tiên thấp hơn vì mạng nội bộ (không internet-
  facing) — xem mục "Production hardening" ở Phase 6. **CORS: ĐÃ build**
  (Phase 7, cần cho web-ui) — không còn nằm trong danh sách chưa làm.
- **`llm-deepseek`/`llm-qwen` tool-calling đơn giản hoá như nhau** (không
  track `tool_call_id` round-trip chuẩn OpenAI — role `'tool'` hạ xuống
  `'user'` có tiền tố khi gửi lên API thật) và **gRPC `StepEvent` flatten
  discriminated union thành field rỗng/không rỗng** thay vì dùng `oneof` —
  cả 3 đã ghi rõ trong code, không phải giới hạn ẩn.
- **`llm-qwen`** wrap đúng proxy OpenAI-compatible `data-agent` đang dùng
  thật (`proxy.onebot.meobeo.ai`, model `Qwen3.5-35B-A3B-FP8`) — có xử lý
  riêng cho hành vi "thinking mode" của Qwen3.5 (model có thể tiêu hết
  `max_tokens` vào `reasoning_content` rồi trả `content: null` nếu hết ngân
  sách token trước — tái hiện được thật lúc build file này), mặc định tắt
  (`enableThinking: false`) khớp config production của `data-agent`. Xem
  `bundles/providers/llm-qwen/index.ts` và
  [`docs/llm-provider-plugin-template.md`](../docs/llm-provider-plugin-template.md)
  (template đã dùng để build provider này).
- **Build `tsc` sẵn ra `dist/*.js`**: image Docker hiện chạy bằng `tsx`
  (transpile lúc chạy) thay vì compile sẵn — đơn giản hơn, image lớn hơn 1
  chút và cold-start chậm hơn 1 chút. Đánh đổi chấp nhận được ở quy mô demo/
  1-instance; xem "Rủi ro" ở Phase 7.2 trong build plan nếu cần tối ưu sau.
