# agent-core

Backend framework cho AI agent, build trên [`@deepseek-ai/cordis`](https://www.npmjs.com/package/@deepseek-ai/cordis) — mọi capability (LLM, storage, tools, subagents, skills, loop driver, phiên hội thoại...) đều là 1 plugin độc lập, mount/unmount/hot-swap được lúc runtime mà không cần restart service.

## Tính năng

- **Agent loop** có 3 driver: `default` (ReAct), `planner-critic`, và `rlm` (persistent RLM/IPython được chuyển từ `data-agent`).
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
seams/      interface thuần: llm, storage, memory, turn-memory, workspace, prompt, tools, permission, sandbox, subagents, skill, loop, agent, sessions, auth
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

Local development dùng Node.js 22 trở lên. Cách chạy Docker bên dưới không cần
Node.js hay Python trên host.

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

Mở `http://localhost:8790`, đăng ký tài khoản đầu tiên (tự động thành `admin`), chat luôn — "+ Chat mới" tạo phiên chat thường (`driver:"default"`); "+ Phân tích dữ liệu" (Sidebar) tạo phiên RLM riêng, chỉ phiên đó mới hiện workspace bar/skill-select (xem `docs/agent-core-rlm-web-ui-plugin-plan.md`).

Để dùng RLM backend qua API trực tiếp (không qua Web UI), tạo session với `driver: "rlm"`. Compose mặc định chạy
Python worker persistent ngay trong container `agent-core`; source adapter/core
RLM nằm trong `python/` và dependencies được Dockerfile tự cài. Host không cần
Python và không cần clone/build thêm repo nào.

`RLM_SANDBOX_PROVIDER=docker` là chế độ cô lập nâng cao: mỗi session dùng một
container/named volume riêng. Khi dùng chế độ này phải cho service truy cập
Docker daemon và đặt `RLM_DOCKER_IMAGE` tới một image agent-core đã build.

```bash
TOKEN=$(curl -s -X POST http://localhost:8787/auth/login \
  -H 'content-type: application/json' -d '{"username":"...","password":"..."}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
curl -X POST http://localhost:8787/sessions \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"driver":"rlm"}'
```

Request message nhận thêm `selectedSkill` và `metadata`; mọi event RLM được
lưu qua `ctx.storage` đồng thời stream qua `agent/step`.

Luồng RLM dùng contract `prepared_turn`, không để Python dựng một application
backend thứ hai:

```text
AgentRunner → loop-rlm
            → ctx.skills + ctx.workspace + ctx.turnMemory + ctx.tools
            → ctx.prompts.render({ driver: 'rlm' })
            → PreparedRlmTurn { prompt }
            → sandbox worker → HarnessRLM → core RLM/IPython
            ← outcome + trajectory
            → ctx.turnMemory.completeTurn() + ctx.storage
```

RLM giữ Python REPL làm action space chính. Tool ứng dụng không được copy vào
container: `PreparedRlmTurn` chỉ quảng bá metadata, IPython inject proxy Python
và chuyển lời gọi `web_search(...)` qua broker → worker `__host_tool__` →
`ctx.tools.invoke()`. Nhờ vậy permission, lifecycle, implementation và UI hint
vẫn thuộc plugin TypeScript; dataset computation vẫn chạy local trong REPL.

Skill package canonical nằm tại `bundles/skills/<name>/SKILL.md`. Hai provider
có vai trò khác nhau: `skill-filesystem` đọc package/resource, còn
`skill-registry` giữ catalog trong RAM và cung cấp `get()`/`readResource()`.
Resource không được đăng ký thành skill con. Với RLM, entrypoint của selected
skill đi trong `PreparedRlmTurn`; `skill_resource("references/...")` đọc lazy
qua worker → `ctx.skills.readResource()`. Có thể override catalog root bằng
`RLM_SKILLS_ROOT`; Python `skill_registry.py` chỉ còn là compatibility code bên
trong runtime vendored và không sở hữu catalog của harness.

`bundles/loop-drivers/loop-rlm/protocol.ts` là nơi duy nhất dựng context gửi
sang Python. `HarnessRLM` không tự load selected skill và không persist memory;
worker chỉ bridge model call về `ctx.llm`. `RLMDataAgent.stream_turn()` vẫn còn
trong `bundles/loop-drivers/loop-rlm/python/rlm_agent` như compatibility path, nhưng plugin không gọi đường
này. Vì vậy có thể thay skill/memory/workspace provider mà không sửa core
RLM. Notebook execution, RLM subcall, compaction và human-control hook vẫn nằm
trong Python vì chúng gắn trực tiếp với lifecycle của core RLM.

Prompt của active RLM harness thuộc TypeScript: `prompt-registry` ghép các
section `{ name, order, text }`; base RLM/data/control policy thuộc
`bundles/prompts/prompt-rlm-data-agent`, còn mỗi tool plugin tự sở hữu section
guidance của nó. Mỗi `PreparedRlmTurn` chỉ mang **một** `prompt` đã render và
version hash để trace. Request, memory snapshot, selected skill và tool metadata
chỉ nằm trong `context_N`, không bị copy vào system prompt. Python gọi
`set_system_prompt(prompt)`; `prompt.py`, `_build_root_prompt()` chỉ còn phục vụ
compatibility path `RLMDataAgent.stream_turn()`.

Dev nhanh cho riêng UI (hot reload, không cần build lại mỗi lần sửa):

```bash
npm run dev:web   # Vite dev server tại :5173, gọi thẳng REST/WS thật — chạy song song với npm run serve
```

### Docker

```bash
cp .env.example .env   # điền OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL_ID, POSTGRES_PASSWORD thật
docker compose up -d --build   # lần đầu hoặc khi dependency/Dockerfile đổi
```

`docker-compose.yml` khởi 3 container: `postgres` (tài khoản/token, healthcheck `pg_isready`), `memory-core` (ctx.memory, TÙY CHỌN — image có sẵn healthcheck riêng, không cần cấu hình gì thêm nếu không dùng) và `agent-core` (chờ Postgres healthy mới boot — KHÔNG chờ `memory-core`, memory-tencentdb tự resilient nên không cần đồng bộ khởi động).

Repo chỉ dùng **một** file Compose. Source TypeScript/React/CSS được mount vào
container: backend tự restart bằng `tsx watch`, UI cập nhật bằng Vite HMR ở
`http://localhost:8790`. Sau khi sửa code bình thường không chạy `--build`.
Nếu đổi Python runtime và cần nạp lại worker, chỉ chạy
`docker compose restart agent-core`; chỉ rebuild khi đổi dependency hoặc
Dockerfile.

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

- `ctx.memory` đã có provider thật (`memory-tencentdb`, TÙY CHỌN — xem `docs/agent-core-memory-integration-plan.md`), đã verify end-to-end qua `docker compose up --build` thật (3 container) + 1 lượt remember→recall thật qua curl (nêu 1 sự thật ở tin nhắn 1, model tự nhớ lại đúng ở tin nhắn 2 — cô lập đúng theo từng user, không rò rỉ giữa các user). `ctx.turnMemory` (rolling summary theo session cho `loop-rlm`, KHÁC `ctx.memory` — xem `docs/agent-core-rlm-harness-merge-plan.md` mục 4.1) có provider `memory-rolling`.
- `sandbox-docker`/`sandbox-ipython` cô lập process/filesystem/network cơ bản, nhưng chưa phải sandbox chống adversarial container escape; production public vẫn cần hardening/remote sandbox phù hợp threat model. Compose mặc định chạy `agent-core` và Python RLM worker trong cùng container; Python source/dependencies được build hoàn toàn từ repo này. Chỉ khi chọn `RLM_SANDBOX_PROVIDER=docker` mới cần Docker socket và hardening theo threat model của môi trường deploy.
- Chạy đúng cho **1 instance** cho phần event-log/session — SQLite (file-based) + session registry (in-memory) chưa hỗ trợ multi-instance/scale ngang. Cần thì đổi provider của `ctx.storage`/`ctx.sessions` (Postgres/Redis), business logic không cần sửa. Riêng `ctx.auth` đã dùng Postgres sẵn (tự chọn cho module này khi build).
- `GET /sessions` chỉ liệt kê session còn "sống" trong session-registry (in-memory, TTL trượt, mất khi restart) — **không phải** kho lưu lịch sử vĩnh viễn. Transcript vẫn còn trong SQLite (`ctx.storage`) nếu nhớ đúng session id, nhưng không được liệt kê lại sau khi session hết TTL/restart.
- Chưa có rate-limiting — trước đây chấp nhận được vì không có endpoint public nào không cần key; giờ `POST /auth/signup`/`/auth/login` là 2 endpoint public thật đầu tiên (chỉ cần username/password, không cần token trước), brute-force là bề mặt tấn công mới chưa có giới hạn tần suất. Plan cụ thể (seam `ctx.ratelimit`, số/endpoint) ở `docs/agent-core-rate-limit-and-security-audit.md`.
- **Audit security thật đã chạy** (xem `docs/agent-core-rate-limit-and-security-audit.md`) — Finding A1 (tool đọc transcript session bất kỳ, kể cả qua workspace file) đã fix lúc merge nhánh RLM harness (xem `docs/agent-core-rlm-harness-merge-plan.md` mục 3.1/3.2). Còn mở: session storage (SQLite) không có khái niệm chủ sở hữu — 1 user có thể "nhận" lại id session đã hết TTL của user khác và đọc transcript cũ của họ (Finding A2).
- Tool-calling đơn giản hoá: không track `tool_call_id` round-trip chuẩn OpenAI.

## Tài liệu thêm

Lịch sử build chi tiết (thiết kế, đánh đổi, bug thật phát hiện lúc implement) và quy tắc code bắt buộc khi thêm seam/bundle mới:

- [`docs/agent-core-cordis-build-plan.md`](docs/agent-core-cordis-build-plan.md)
- [`docs/agent-core-cordis-coding-rules.md`](docs/agent-core-cordis-coding-rules.md)
- [`docs/ui-plugin-build-guide.md`](docs/ui-plugin-build-guide.md) — quy trình build 1 UI-plugin mới cho Web UI
- [`docs/agent-core-ui-architecture.md`](docs/agent-core-ui-architecture.md) — cách chia package Web UI (mirror cấu trúc dsh), quy ước scaffold package mới
- [`docs/agent-core-memory-integration-plan.md`](docs/agent-core-memory-integration-plan.md) — plan tích hợp TencentDB Agent Memory vào `ctx.memory` (đã build + đã verify end-to-end thật qua Docker — xem Phase 25 trong build-plan)
- [`docs/agent-core-rate-limit-and-security-audit.md`](docs/agent-core-rate-limit-and-security-audit.md) — audit security thật (authn/authz toàn bộ plugin, file:line + kịch bản khai thác cụ thể) + plan rate-limiting (seam `ctx.ratelimit` mới, chưa implement — xem Phase 26 trong build-plan)
- [`docs/agent-core-rlm-harness-merge-plan.md`](docs/agent-core-rlm-harness-merge-plan.md) — merge RLM harness (data-agent Python đa lượt) vào `dev`: logic/flow, quyết định thiết kế, gap thật phát hiện lúc merge
- [`docs/agent-core-rlm-harness-components.md`](docs/agent-core-rlm-harness-components.md) — giới thiệu chi tiết logic/flow/cấu trúc các cấu phần RLM harness sau merge (viết lại, phản ánh đúng trạng thái hiện tại — `ctx.turnMemory`, security fix...)
- [`docs/agent-core-rlm-web-ui-flow.md`](docs/agent-core-rlm-web-ui-flow.md) — flow web UI hiện dùng RLM thế nào, bảng đối chiếu 14 loại `LoopStep` RLM phát ra vs 4 loại UI thật sự hiện (khảo sát cho việc lên kế hoạch update UI, chưa sửa gì)
- [`docs/agent-core-rlm-web-ui-plugin-plan.md`](docs/agent-core-rlm-web-ui-plugin-plan.md) — tách UI workspace RLM thành UI-plugin thật (`ctx.slots`), đổi driver mặc định về `default`, RLM thành lựa chọn chủ động (ĐÃ implement + verify — xem Phase 28 trong build-plan)
- [`docs/system-architecture.md`](docs/system-architecture.md) — kiến trúc RLM harness (loop-rlm/sandbox/workspace/prompt), request flow, ownership và tác dụng từng folder/file quan trọng (viết trước merge, đã vá vài chỗ lỗi thời)
- [`docs/frontend-backend-handoff.md`](docs/frontend-backend-handoff.md) — contract REST/WebSocket/workspace và checklist bàn giao cho đội frontend
- [`docs/agent-core-adding-plugins.md`](docs/agent-core-adding-plugins.md) — thêm 1 plugin: sửa source (`bundles/`) hay bên ngoài không cần sửa source (`EXTRA_PLUGINS`) — hướng dẫn + ví dụ đầy đủ
- [`docs/agent-core-plugin-template.md`](docs/agent-core-plugin-template.md) — code mẫu copy-paste (tool/skill/provider), đã verify typecheck thật đối chiếu type thật của repo
- [`docs/agent-core-skill-business-case-builder-plan.md`](docs/agent-core-skill-business-case-builder-plan.md) — skill `business-case-builder`: kịch bản kinh doanh + khung KPI + 3 loại phân tích, dùng `web_search`, kích hoạt qua từ khoá ở cả chat thường lẫn RLM (ĐÃ implement + verify — xem Phase 32 trong build-plan)
