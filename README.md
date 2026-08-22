# agent-core

Backend framework cho AI agent, build trên [`@deepseek-ai/cordis`](https://www.npmjs.com/package/@deepseek-ai/cordis) — mọi capability (LLM, storage, tools, subagents, skills, loop driver, phiên hội thoại...) đều là 1 plugin độc lập, mount/unmount/hot-swap được lúc runtime mà không cần restart service.

## Tính năng

- **Agent loop** có 3 driver: `default` (ReAct), `planner-critic`, và `rlm` (persistent RLM/IPython được chuyển từ `data-agent`).
- **3 giao thức API dùng chung 1 core**: REST, WebSocket (stream từng bước xử lý real-time), gRPC (unary + server-streaming).
- **Web UI React** đầy đủ: sidebar lịch sử hội thoại (resume lại session cũ), stream real-time theo từng bước, UI riêng cho từng loại tool-call (kiến trúc slot-registry mở rộng được).
- **Tool registry** mở rộng được — sẵn 2 tool thật: tìm kiếm web (DuckDuckGo, không cần API key) và tra cứu dữ liệu đã lưu.
- **Subagent registry** — uỷ thác 1 task cho 1 lượt chạy tách biệt (vd. viết báo cáo).
- **Skill registry** — nạp hướng dẫn tĩnh vào system prompt có điều kiện, dựa trên từ khoá khớp tin nhắn người dùng (khác tool: không phải hàm model tự gọi).
- **Auth API key** (so khớp constant-time, chống timing attack), giới hạn kích thước request, retry cho lỗi mạng thoáng qua, TTL cho session/lịch sử, retention tự dọn dữ liệu cũ.
- **Đóng gói Docker sẵn** — multi-stage build, healthcheck, volume persist dữ liệu qua restart.

## Tech stack

| | |
|---|---|
| Backend | TypeScript, [`@deepseek-ai/cordis`](https://www.npmjs.com/package/@deepseek-ai/cordis) (DI/plugin/lifecycle), Node.js |
| Storage | SQLite (`better-sqlite3`), WAL mode |
| Realtime | `ws` (WebSocket), `@grpc/grpc-js` + `@grpc/proto-loader` (gRPC) |
| LLM | OpenAI-compatible API (DeepSeek, Qwen qua proxy nội bộ) — thêm provider khác qua seam `ctx.llm` |
| Frontend | React, Vite, CSS Modules (design-token system riêng, 3 tầng: static → alias → specific) |
| Test | Vitest |
| Deploy | Docker, docker compose |

## Kiến trúc

Tách biệt **seam** (interface thuần, seams/) khỏi **provider** (implementation thật, bundles/) — code nghiệp vụ chỉ phụ thuộc vào interface, đổi implementation không ảnh hưởng phần còn lại của hệ thống (đổi LLM provider, đổi loop driver, đổi storage backend... đều không sửa business logic).

```
seams/      interface thuần: llm, storage, memory, workspace, tools, permission, sandbox, subagents, skill, loop, agent, sessions, auth
bundles/
├── providers/     implement 1 seam cụ thể (ctx.<key> = instance thật)
├── tools/         tool đăng ký vào ctx.tools
├── subagents/     subagent đăng ký vào ctx.subagents
├── skills/        skill đăng ký vào ctx.skills
├── loop-drivers/  driver đăng ký vào ctx.loop (hot-swap được)
└── adapters/      REST / WS / gRPC / Web UI — transport mỏng, không chứa business logic
apps/web/   Web UI (React + Vite)
packages/   design-system (ui-theme, ui-primitives) + slot-registry cho UI-plugin (ui-slots, ui-react) + ví dụ UI-plugin (ui-tool-web-search)
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
| `API_KEYS` | Danh sách API key hợp lệ cho REST/WS/gRPC, cách nhau bởi dấu phẩy |

```bash
npm run build:web   # build Web UI ra apps/web/dist — bắt buộc trước lần chạy đầu, hoặc sau khi sửa apps/web
OPENAI_API_KEY=sk-... OPENAI_BASE_URL=... OPENAI_MODEL_ID=... API_KEYS=key1,key2 npm run serve
```

Mở `http://localhost:8790`, nhập 1 trong các `API_KEYS` ở nút cấu hình, chat luôn.

Để dùng RLM backend, tạo session với `driver: "rlm"`. Mặc định
`sandbox-docker` chạy worker bằng image `data-agent-backend:latest`, nên host
không cần cài Python dependencies. Build image một lần bằng
`docker compose -f ../data-agent/docker-compose.yml build backend`. Có thể đổi
image/source bằng `RLM_DOCKER_IMAGE`, `RLM_DATA_AGENT_ROOT`. Mỗi session dùng
một Docker named volume riêng làm workspace; Node không tạo thư mục workspace
trên host. Prefix volume có thể đổi bằng `RLM_DOCKER_VOLUME_PREFIX`.

Chỉ khi chủ động đặt `RLM_SANDBOX_PROVIDER=local` mới dùng Python trên host;
lúc đó `RLM_WORKSPACE_BASE` là thư mục workspace host và `RLM_PYTHON_BIN` phải
trỏ tới environment đã cài dependencies.

```bash
curl -X POST http://localhost:8787/sessions \
  -H 'Authorization: Bearer key1' -H 'content-type: application/json' \
  -d '{"driver":"rlm"}'
```

Request message nhận thêm `selectedSkill` và `metadata`; mọi event RLM được
lưu qua `ctx.storage` đồng thời stream qua `agent/step`.

Luồng RLM dùng contract `prepared_turn`, không để Python dựng một application
backend thứ hai:

```text
AgentRunner → loop-rlm
            → ctx.skills + ctx.workspace + ctx.memory + ctx.tools
            → ctx.prompts.render({ driver: 'rlm' })
            → PreparedRlmTurn { prompt }
            → sandbox worker → HarnessRLM → core RLM/IPython
            ← outcome + trajectory
            → ctx.memory.completeTurn() + ctx.storage
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
`RLM_SKILLS_ROOT`; Python `skill_registry.py` chỉ còn cho legacy data-agent.

`bundles/loop-drivers/loop-rlm/protocol.ts` là nơi duy nhất dựng context gửi
sang Python. `HarnessRLM` không tự load selected skill và không persist memory;
worker chỉ bridge model call về `ctx.llm`. `RLMDataAgent.stream_turn()` vẫn còn
trong data-agent như compatibility path cho caller cũ, nhưng plugin không gọi
đường này. Vì vậy có thể thay skill/memory/workspace provider mà không sửa core
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
cp .env.example .env   # điền OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL_ID, API_KEYS thật
docker compose up --build
```

| Port | Giao thức |
|---|---|
| 8787 | REST |
| 8788 | WebSocket |
| 50051 | gRPC |
| 8790 | Web UI |

Dữ liệu (`data/sessions.db`) lưu trên volume `agent-core-data`, sống sót qua restart/recreate container.

## API

- **REST** — `POST /sessions`, `POST /sessions/:id/messages`, `GET /sessions/:id/events`, `GET /health`, `GET /ready`. Auth qua header `Authorization: Bearer <key>` (trừ `/health`, `/ready`).
- **WebSocket** — giao thức JSON 2 chiều: `create_session` / `send_message` → nhận stream `step` theo từng bước xử lý → `done`. Auth qua header (client Node) hoặc query string `?key=...` (bắt buộc cho trình duyệt — Web spec không cho set header lúc WS handshake).
- **gRPC** — service `AgentService`: `CreateSession`, `SendMessage` (unary), `StreamTurn` (server-streaming). Auth qua metadata `authorization`.

## Giới hạn hiện tại

- `sandbox-docker` cô lập process/filesystem/network cơ bản, nhưng chưa phải sandbox chống adversarial container escape; production public vẫn cần hardening/remote sandbox phù hợp threat model.
- Compose mặc định chạy `agent-core` và Python RLM worker trong cùng container;
  Python runtime được copy từ `data-agent-backend:latest` lúc build. Chỉ khi
  chọn `RLM_SANDBOX_PROVIDER=docker` mới cần Docker socket và hardening theo
  threat model của môi trường deploy.
- Chạy đúng cho **1 instance** — SQLite (file-based) + session registry (in-memory) chưa hỗ trợ multi-instance/scale ngang. Cần thì đổi provider của `ctx.storage`/`ctx.sessions` (Postgres/Redis), business logic không cần sửa.
- Chưa có rate-limiting (giả định mạng nội bộ, không phải endpoint public).
- Tool-calling đơn giản hoá: không track `tool_call_id` round-trip chuẩn OpenAI.

## Tài liệu thêm

- [`docs/system-architecture.md`](docs/system-architecture.md) — kiến trúc hiện tại, request flow, ownership và tác dụng từng folder/file quan trọng
- [`docs/frontend-backend-handoff.md`](docs/frontend-backend-handoff.md) — contract REST/WebSocket/workspace và checklist bàn giao cho đội frontend
