# agent-core

Backend framework cho AI agent, build trên [`@deepseek-ai/cordis`](https://www.npmjs.com/package/@deepseek-ai/cordis) — mọi capability (LLM, storage, tools, subagents, skills, loop driver, phiên hội thoại...) đều là 1 plugin độc lập, mount/unmount/hot-swap được lúc runtime mà không cần restart service.

## Tính năng

- **Agent loop** kiểu ReAct (model ↔ tool ↔ storage), có sẵn 2 driver hot-swap được cho nhau lúc đang chạy: `loop-default` (mặc định) và `loop-planner-critic` (thêm 1 lượt tự phê bình trước khi chốt câu trả lời).
- **3 giao thức API dùng chung 1 core**: REST, WebSocket (stream từng bước xử lý real-time), gRPC (unary + server-streaming).
- **Web UI React** đầy đủ: sidebar lịch sử hội thoại (resume lại session cũ), stream real-time theo từng bước, UI riêng cho từng loại tool-call (kiến trúc slot-registry mở rộng được).
- **Tool registry** mở rộng được — sẵn 2 tool thật: tìm kiếm web (DuckDuckGo, không cần API key) và tra cứu dữ liệu đã lưu.
- **Subagent registry** — uỷ thác 1 task cho 1 lượt chạy tách biệt (vd. viết báo cáo).
- **Skill registry** — nạp hướng dẫn tĩnh vào system prompt có điều kiện, dựa trên từ khoá khớp tin nhắn người dùng (khác tool: không phải hàm model tự gọi).
- **Tài khoản người dùng thật** (đăng ký/đăng nhập, mật khẩu hash `scrypt`, token bearer, vai trò admin/user, admin panel quản lý user) — thay thế hoàn toàn API key dùng chung cũ. Giới hạn kích thước request, retry cho lỗi mạng thoáng qua, TTL cho session, retention tự dọn dữ liệu cũ.
- **Đóng gói Docker sẵn** — multi-stage build, healthcheck, volume persist dữ liệu qua restart.

## Tech stack

| | |
|---|---|
| Backend | TypeScript, [`@deepseek-ai/cordis`](https://www.npmjs.com/package/@deepseek-ai/cordis) (DI/plugin/lifecycle), Node.js |
| Storage | SQLite (`better-sqlite3`, event log hội thoại), WAL mode |
| Auth | PostgreSQL (`pg`) — tài khoản/token người dùng thật (`ctx.auth`, `bundles/providers/auth-users`) |
| Memory | TencentDB Agent Memory / MemoryCore (`@tencentdb-agent-memory/memory-sdk-ts-v2`) — nhớ ngữ cảnh theo từng user, TÙY CHỌN (`ctx.memory`, `bundles/providers/memory-tencentdb`) |
| Realtime | `ws` (WebSocket), `@grpc/grpc-js` + `@grpc/proto-loader` (gRPC) |
| LLM | OpenAI-compatible API (DeepSeek, Qwen qua proxy nội bộ) — thêm provider khác qua seam `ctx.llm` |
| Frontend | React, Vite, CSS Modules (design-token system riêng, 3 tầng: static → alias → specific) |
| Test | Vitest |
| Deploy | Docker, docker compose |

## Kiến trúc

Tách biệt **seam** (interface thuần, seams/) khỏi **provider** (implementation thật, bundles/) — code nghiệp vụ chỉ phụ thuộc vào interface, đổi implementation không ảnh hưởng phần còn lại của hệ thống (đổi LLM provider, đổi loop driver, đổi storage backend... đều không sửa business logic).

```
seams/      interface thuần: llm, storage, memory, tools, permission, sandbox, subagents, skill, loop, agent, sessions, auth
bundles/
├── providers/     implement 1 seam cụ thể (ctx.<key> = instance thật)
├── tools/         tool đăng ký vào ctx.tools
├── subagents/     subagent đăng ký vào ctx.subagents
├── skills/        skill đăng ký vào ctx.skills
├── loop-drivers/  driver đăng ký vào ctx.loop (hot-swap được)
└── adapters/      REST / WS / gRPC / Web UI — transport mỏng, không chứa business logic
apps/web/   Web UI (React + Vite) — compose gốc, giữ WS/session state
packages/
├── ui-theme, ui-primitives          design-system (token 3 tầng, Button/Modal/Toast/Pill/StateDot/SourceList/Skeleton)
├── ui-slots, ui-react               slot-registry cho UI-plugin (cơ chế plugin thật, xem docs/ui-plugin-build-guide.md)
├── ui-tool-web-search               ví dụ UI-plugin (đăng ký vào slot 'tool.call.toolview')
└── ui-sidebar, ui-layout,           chia theo package mirror cấu trúc dsh — xem
    ui-conversation,                 docs/agent-core-ui-architecture.md cho ranh giới/dependency graph đầy đủ
    ui-settings-general, ui-auth     (ui-auth: LoginForm/SignupForm/AdminUsersPanel)
tests/      test tự động
src/serve.ts   entrypoint boot backend
```

## Bắt đầu

### Cài đặt

```bash
npm install
```

### Kiểm tra

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest — pretest tự build lại Web UI
```

### Chạy local

Cần đủ 4 biến môi trường sau — thiếu 1 trong 4 là service dừng ngay lúc boot với lỗi rõ ràng (không boot nửa vời):

| Biến | Ý nghĩa |
|---|---|
| `OPENAI_API_KEY` | API key gọi model |
| `OPENAI_BASE_URL` | Endpoint model/proxy (không có default cứng) |
| `OPENAI_MODEL_ID` | Tên model trên endpoint đó |
| `DATABASE_URL` | Connection string Postgres cho tài khoản/token (`ctx.auth`) — vd. `postgres://user:pass@localhost:5432/db` |

Không chạy qua `docker compose` thì cần tự có 1 Postgres reachable trước — cách nhanh nhất: `docker compose up postgres -d` (chỉ khởi động đúng service Postgres, không cần build cả app) rồi trỏ `DATABASE_URL` vào đó.

Module memory (`ctx.memory`) **hoàn toàn tùy chọn** — bỏ trống, hệ thống chạy y hệt không có nó. Muốn bật: set thêm `MEMORY_CORE_URL` + `MEMORY_CORE_API_KEY` (bắt buộc đủ cả 2, thiếu 1 trong 2 là service dừng ngay lúc boot) trỏ vào 1 MemoryCore đang chạy (`docker compose up memory-core -d` cho local, hoặc dùng chung stack `docker compose up --build` bên dưới).

```bash
npm run build:web   # build Web UI ra apps/web/dist — bắt buộc trước lần chạy đầu, hoặc sau khi sửa apps/web
docker compose up postgres -d   # cần Postgres reachable trước khi serve — xem trên
OPENAI_API_KEY=sk-... OPENAI_BASE_URL=... OPENAI_MODEL_ID=... DATABASE_URL=postgres://agent_core:<mật khẩu>@localhost:5432/agent_core_users npm run serve
```

Mở `http://localhost:8790`, đăng ký tài khoản đầu tiên (tự động thành `admin`), chat luôn.

Dev nhanh cho riêng UI (hot reload, không cần build lại mỗi lần sửa):

```bash
npm run dev:web   # Vite dev server tại :5173, gọi thẳng REST/WS thật — chạy song song với npm run serve
```

### Docker

```bash
cp .env.example .env   # điền OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL_ID, POSTGRES_PASSWORD thật
docker compose up --build
```

`docker-compose.yml` khởi 3 container: `postgres` (tài khoản/token, healthcheck `pg_isready`), `memory-core` (ctx.memory, TÙY CHỌN — image có sẵn healthcheck riêng, không cần cấu hình gì thêm nếu không dùng) và `agent-core` (chờ Postgres healthy mới boot — KHÔNG chờ `memory-core`, memory-tencentdb tự resilient nên không cần đồng bộ khởi động).

| Port | Giao thức |
|---|---|
| 8787 | REST |
| 8788 | WebSocket |
| 50051 | gRPC |
| 8790 | Web UI |

Dữ liệu hội thoại (`data/sessions.db`) lưu trên volume `agent-core-data`; tài khoản/token lưu trên volume Postgres riêng `agent-core-postgres-data` — cả 2 sống sót qua restart/recreate container.

## API

- **REST** — `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /sessions` (chỉ session của chính caller — admin thấy hết), `GET/PATCH/DELETE /users/:id` (admin), `POST /sessions`, `POST /sessions/:id/messages`, `GET /sessions/:id/events`, `GET /health`, `GET /ready`. Auth qua header `Authorization: Bearer <token>` (trừ `/health`, `/ready`, `/auth/signup`, `/auth/login`) — token lấy từ `POST /auth/login`/`/auth/signup`, không còn API key tĩnh.
- **WebSocket** — giao thức JSON 2 chiều: `create_session` / `send_message` → nhận stream `step` theo từng bước xử lý → `done`. Auth qua header (client Node) hoặc query string `?token=...` (bắt buộc cho trình duyệt — Web spec không cho set header lúc WS handshake).
- **gRPC** — service `AgentService`: `CreateSession`, `SendMessage` (unary), `StreamTurn` (server-streaming). Auth qua metadata `authorization`. Không có RPC riêng cho signup/login/quản lý user — đăng ký/quản lý tài khoản là REST-only, có chủ đích (xem `bundles/adapters/api-grpc`).

## Giới hạn hiện tại

- `ctx.memory` đã có provider thật (`memory-tencentdb`, TÙY CHỌN — xem `docs/agent-core-memory-integration-plan.md`), đã verify end-to-end qua `docker compose up --build` thật (3 container) + 1 lượt remember→recall thật qua curl (nêu 1 sự thật ở tin nhắn 1, model tự nhớ lại đúng ở tin nhắn 2 — cô lập đúng theo từng user, không rò rỉ giữa các user). `ctx.sandbox` vẫn mới có interface (`seams/`), chưa có provider thật.
- Chạy đúng cho **1 instance** cho phần event-log/session — SQLite (file-based) + session registry (in-memory) chưa hỗ trợ multi-instance/scale ngang. Cần thì đổi provider của `ctx.storage`/`ctx.sessions` (Postgres/Redis), business logic không cần sửa. Riêng `ctx.auth` đã dùng Postgres sẵn (tự chọn cho module này khi build).
- `GET /sessions` chỉ liệt kê session còn "sống" trong session-registry (in-memory, TTL trượt, mất khi restart) — **không phải** kho lưu lịch sử vĩnh viễn. Transcript vẫn còn trong SQLite (`ctx.storage`) nếu nhớ đúng session id, nhưng không được liệt kê lại sau khi session hết TTL/restart.
- Chưa có rate-limiting — trước đây chấp nhận được vì không có endpoint public nào không cần key; giờ `POST /auth/signup`/`/auth/login` là 2 endpoint public thật đầu tiên (chỉ cần username/password, không cần token trước), brute-force là bề mặt tấn công mới chưa có giới hạn tần suất. Plan cụ thể (seam `ctx.ratelimit`, số/endpoint) ở `docs/agent-core-rate-limit-and-security-audit.md`.
- **Audit security thật đã chạy, còn 2 finding mức CAO chưa xử lý** (xem `docs/agent-core-rate-limit-and-security-audit.md`): (1) tool `query_database` đọc được transcript của BẤT KỲ session nào qua tool-call, không check ownership (bỏ qua lớp bảo vệ đã có ở REST/WS/gRPC); (2) session storage (SQLite) không có khái niệm chủ sở hữu, kết hợp việc REST/gRPC cho phép client tự chọn session id — 1 user có thể "nhận" lại id đã hết TTL của user khác và đọc transcript cũ của họ.
- Tool-calling đơn giản hoá: không track `tool_call_id` round-trip chuẩn OpenAI.

## Tài liệu thêm

Lịch sử build chi tiết (thiết kế, đánh đổi, bug thật phát hiện lúc implement) và quy tắc code bắt buộc khi thêm seam/bundle mới:

- [`docs/agent-core-cordis-build-plan.md`](docs/agent-core-cordis-build-plan.md)
- [`docs/agent-core-cordis-coding-rules.md`](docs/agent-core-cordis-coding-rules.md)
- [`docs/ui-plugin-build-guide.md`](docs/ui-plugin-build-guide.md) — quy trình build 1 UI-plugin mới cho Web UI
- [`docs/agent-core-ui-architecture.md`](docs/agent-core-ui-architecture.md) — cách chia package Web UI (mirror cấu trúc dsh), quy ước scaffold package mới
- [`docs/agent-core-memory-integration-plan.md`](docs/agent-core-memory-integration-plan.md) — plan tích hợp TencentDB Agent Memory vào `ctx.memory` (đã build + đã verify end-to-end thật qua Docker — xem Phase 25 trong build-plan)
- [`docs/agent-core-rate-limit-and-security-audit.md`](docs/agent-core-rate-limit-and-security-audit.md) — audit security thật (authn/authz toàn bộ plugin, file:line + kịch bản khai thác cụ thể) + plan rate-limiting (seam `ctx.ratelimit` mới, chưa implement — xem Phase 26 trong build-plan)
