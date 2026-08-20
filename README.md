# agent-core

Backend framework cho AI agent, build trên [`@deepseek-ai/cordis`](https://www.npmjs.com/package/@deepseek-ai/cordis) — mọi capability (LLM, storage, tools, subagents, skills, loop driver, phiên hội thoại...) đều là 1 plugin độc lập, mount/unmount/hot-swap được lúc runtime mà không cần restart service.

## Tính năng

- **Agent loop** kiểu ReAct (model ↔ tool ↔ storage), có sẵn 2 driver hot-swap được cho nhau lúc đang chạy: `loop-default` (mặc định) và `loop-planner-critic` (thêm 1 lượt tự phê bình trước khi chốt câu trả lời).
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
seams/      interface thuần: llm, storage, memory, tools, permission, sandbox, subagents, skill, loop, agent, sessions, auth
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

- `ctx.memory` (lưu trữ/truy xuất ngữ cảnh dài hạn) và `ctx.sandbox` mới có interface (`seams/`), chưa có provider thật.
- Chạy đúng cho **1 instance** — SQLite (file-based) + session registry (in-memory) chưa hỗ trợ multi-instance/scale ngang. Cần thì đổi provider của `ctx.storage`/`ctx.sessions` (Postgres/Redis), business logic không cần sửa.
- Chưa có rate-limiting (giả định mạng nội bộ, không phải endpoint public).
- Tool-calling đơn giản hoá: không track `tool_call_id` round-trip chuẩn OpenAI.

## Tài liệu thêm

Lịch sử build chi tiết (thiết kế, đánh đổi, bug thật phát hiện lúc implement) và quy tắc code bắt buộc khi thêm seam/bundle mới:

- [`docs/agent-core-cordis-build-plan.md`](../docs/agent-core-cordis-build-plan.md)
- [`docs/agent-core-cordis-coding-rules.md`](../docs/agent-core-cordis-coding-rules.md)
- [`docs/ui-plugin-build-guide.md`](../docs/ui-plugin-build-guide.md) — quy trình build 1 UI-plugin mới cho Web UI
