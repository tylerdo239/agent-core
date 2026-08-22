# Agent Core trên Cordis — Tài liệu tổng hợp

## 1. Triết lý thiết kế — nguyên tắc xuyên suốt

**Không plugin hoá mọi thứ.** "Everything is a plugin" là lựa chọn đúng cho DeepSeek (họ build nền tảng cho hàng nghìn dev khác nhau), không tự động đúng cho 1 agent cụ thể. Áp dụng YAGNI: chỉ plugin hoá khi có nhu cầu thật, không làm trước "để phòng".

**3 tầng, 3 chính sách swap khác nhau:**

| Tầng                                               | Ví dụ                     | Chính sách                                                 |
| -------------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| **Capability** (stateless per-call)                | Models, Tools, Skills, UI | Tháo lắp tự do, không cần pin                              |
| **Orchestration** (stateful trong 1 turn/job)      | Loop, Sandbox, Scheduling | Boundary-swap — pin theo session lúc tạo, không mid-flight |
| **Infrastructure** (hạ tầng dùng chung, có schema) | Sessions, Storage         | Gần như cố định — đổi = migration có kế hoạch              |

**Mid-flight swap gần như không cần thiết.** Mục tiêu "tháo lắp không restart hệ thống" đạt đủ ở mức **boundary-swap** (đổi registry ngay, chỉ áp dụng cho session/turn mới, cái đang chạy dở hoàn tất bằng bản cũ). Chỉ dùng kill-switch/circuit-breaker riêng cho 2 trường hợp thật: bảo mật khẩn cấp và turn chạy quá dài.

---

## 2. Core dùng Cordis thật — không phải mô phỏng

**`@deepseek-ai/cordis`** — package npm độc lập, không cần clone dsh. Setup:

```bash
npm install @deepseek-ai/cordis
```

**Cordis cung cấp sẵn 2 cơ chế đúng theo yêu cầu ban đầu (nhắc lại paper gốc):**

- **Temporal composability** = _revertible effects_ — mọi đăng ký qua `ctx.on`, `ctx.setInterval`, service lifecycle tự rollback khi `fiber.dispose()`, không cần tự viết cleanup thủ công.
- **Spatial composability** = _reactive coeffects_ — khai báo `inject: ['storage']`, Cordis tự activate khi dependency có, tự suspend khi mất, tự resume khi quay lại — không lỗi giữa chừng.
- Giải quyết đúng **"granularity mismatch"**: compose ở mức function-call trong cùng address space, không phải mức process/container như OS/orchestrator — nhưng **chỉ cho component tin cậy lẫn nhau**, không thay thế isolation bảo mật (Sandbox vẫn phải tách process/VM thật).

**Rủi ro cần nhớ:** `@deepseek-ai/cordis` đang phát triển tích cực, API chưa ổn định — ghim version cứng, không dùng `^`.

---

## 3. Cấu trúc thư mục core

```
agent-core/
├── seams/                    # Service Definition — CHỈ interface, không implementation
│   ├── storage.ts
│   ├── session-manager.ts
│   ├── llm.ts
│   ├── loop.ts
│   ├── tools.ts
│   ├── skill.ts
│   ├── memory.ts
│   ├── sandbox.ts
│   └── permission.ts
│
├── bundles/                   # Service Provider — mỗi seam có thể có NHIỀU provider
│   ├── state-sqlite/ | state-postgres/
│   ├── session-manager-default/
│   ├── llm-deepseek/ | llm-openai/
│   ├── loop-default/ | loop-planner-critic/
│   ├── tool-web-search-google/    # xem cấu trúc chi tiết ở mục 5
│   ├── skill-registry-default/
│   ├── memory-simple/
│   ├── sandbox-opensandbox/
│   ├── auth-jwt-local/
│   └── ui-web/
│
├── profiles/                  # chồng bundle theo môi trường
│   ├── local.yaml
│   ├── staging.yaml
│   └── prod.yaml
│
├── core/                       # object runtime, KHÔNG phải plugin (Session, ToolRegistry snapshot...)
├── telemetry/                   # OpenTelemetry setup, xem mục 8
├── frontend/                     # Next.js — UI slot, xem mục 6
├── docker-compose.yml
└── package.json
```

**Ý nghĩa `seams/`:** tầng thiết kế thuần interface (`abstract class`, không logic) — trả lời "hệ thống có khả năng gì, giao tiếp qua đâu". Không chạy được gì nếu đứng 1 mình; giá trị chỉ hiện ra khi `bundles/` implement và `inject` tham chiếu tới nó. Tách riêng khỏi `bundles/` vì 1 seam có thể có nhiều provider (SQLite/Postgres cùng implement `StorageService`).

---

## 4. Roadmap build — theo dependency graph, không theo tên tính năng

```
Storage → Sessions → LLM → Loop RỖNG (mốc quan trọng nhất — agent chạy thật lần đầu)
   → Tools → Skills → Memory → Sandbox (song song, độc lập) → UI (song song từ Loop)
   → Observability (bọc dần, không phải bước cuối) → Chaos test tổng hợp
```

| Bước              | Deliverable                                                                            |
| ----------------- | -------------------------------------------------------------------------------------- |
| 1. Storage        | Ghi/đọc event vào SQLite, dispose sạch connection                                      |
| 2. Sessions       | `ctx.sessions.create()`/`resume()` hoạt động đúng                                      |
| 3. LLM            | `ctx.llm.chat()` trả lời thật                                                          |
| 4. Loop rỗng      | **Turn end-to-end đầu tiên chạy được** — WebSocket → model → event log → trả về client |
| 5. Tools          | Vòng `model_message → tool_result → model_message` chạy đúng                           |
| 6. Skills         | Model đổi hành vi theo nội dung skill bật/tắt                                          |
| 7. Memory         | Thông tin từ conversation A "nhớ" sang conversation B của cùng user                    |
| 8. Sandbox        | Code chạy cô lập, Sandbox lỗi không ảnh hưởng Cordis Context                           |
| 9. UI             | Chat + tool result render, có fallback khi UI riêng chưa gắn                           |
| 10. Observability | Trace xuyên suốt turn → tool → MCP subprocess → sandbox                                |
| 11. Chaos test    | Hot-swap plugin khi hệ thống đang chạy, không restart, không crash lan                 |

**Bước 1-5 đã là 1 agent hoàn chỉnh dùng được** (nói chuyện + gọi tool). Bước 6-11 là mở rộng, chỉ làm khi có nhu cầu cụ thể.

---

## 5. Ý nghĩa từng cấu phần — tóm tắt nhanh

| Cấu phần                    | Bản chất                                                                   | Quan hệ với cấu phần khác                                                                         |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Loop**                    | Thuật toán điều phối (khi nào gọi model/tool/dừng)                         | **Dùng** Tool/Skill qua registry chung, **không sở hữu** chúng — như nhạc trưởng và nhạc cụ       |
| **Tool**                    | 1 khả năng model có thể gọi, đăng ký vào `ctx.tools`                       | Nhiều Loop khác nhau dùng chung 1 registry tool                                                   |
| **Skill**                   | Nội dung instruction/text nạp vào prompt, KHÔNG phải code                  | Đơn giản hơn Tool nhiều — không có logic thực thi                                                 |
| **Memory**                  | Ngữ cảnh **xuyên suốt nhiều conversation** của 1 user                      | Khác Storage — Storage là event log của **1** conversation                                        |
| **Storage**                 | Event log append-only của 1 session                                        | 1 backend vật lý, nhiều session phân vùng theo `session_id`                                       |
| **Sessions/SessionManager** | Điều phối tạo/resume/fork Session, dùng Storage bên dưới                   | Tách biệt Storage — Storage không biết "resume nghĩa là gì"                                       |
| **Session** (object)        | Runtime, KHÔNG phải plugin — pin `ctx.loop`/`ctx.storage` lúc tạo          | Nhiều Session cùng lúc, dùng chung Storage/LLM/Loop đã pin                                        |
| **Sandbox**                 | Chạy **NGOÀI** Cordis Context hoàn toàn — chỉ có client mỏng trong Context | Trust boundary bắt buộc — code không tin cậy không được chung address space với component tin cậy |

---

## 6. Chuẩn 1 Plugin — Python logic, TS wrap

```
bundles/tool-web-search-google/
├── src/
│   ├── index.ts       # Loader metadata — CHỈ export (name, inject, Config, apply), KHÔNG export default
│   ├── config.ts        # schema zod
│   └── runtime.ts        # chỉ mount MCP client, không tự implement logic
├── python/               # LOGIC THẬT — 100% nghiệp vụ, test độc lập
│   ├── server.py
│   └── requirements.txt
├── ui/                     # (tuỳ chọn) CSS Modules bắt buộc
│   ├── ToolView.tsx
│   ├── ToolView.module.css
│   └── register.ts
├── tests/
│   ├── harness.ts          # mount Cordis THẬT, không mock
│   └── plugin.spec.ts       # test cả activate lẫn dispose
├── cordis.patch.yml          # manifest thật — cách host mount plugin
└── package.json              # field "dsh.bundle.patch" + postinstall cài Python deps
```

**Quy tắc bắt buộc:**

1. `index.ts` không bao giờ `export default` — Cordis Loader unwrap `exports.default ?? exports`, thừa 1 default sẽ âm thầm xoá `inject`/`Config`/`apply`
2. Logic nghiệp vụ nằm 100% ở `python/server.py`, TS chỉ mount `McpClient` trỏ tới đó
3. Test bằng Cordis thật (`fiber.dispose()`), không tin suông docs

**Vì sao TS bắt buộc, Python được tự do:** Kernel/plugin object (`ctx.provide`/`ctx.inject`) phải chạy cùng process Node.js với Cordis. Nhưng **logic bên trong tool** hoàn toàn tự do — qua MCP server (khuyến nghị chính thức), hoặc code chạy trong Sandbox (agent tự viết Python, sandbox không quan tâm ngôn ngữ).

---

## 7. UI — Slot pattern, tách biệt khỏi Cordis

Browser không chạy Cordis — UI dùng **registry pattern thuần React**, cùng tinh thần `seams/` nhưng cơ chế khác:

```typescript
registerSlot("tool-result", "web_search", WebSearchView);
registerSlot("sidebar-panel", "trajectory-viewer", TrajectoryPanel);
```

**3 lớp phòng thủ bắt buộc cho mọi tool-view:**

1. **Contract validation** (zod ở frontend) — chặn payload sai hình dạng
2. **Fallback view** (`DefaultToolView` + `view_hint`) — luôn hiển thị được gì đó, kể cả khi chưa có UI riêng
3. **Error Boundary** riêng từng tool-view — 1 UI lỗi không sập cả conversation

**CSS isolation theo mức tin cậy:**

- Nội bộ team → CSS Modules + Design Token (`--tv-*`) là đủ, chặn bằng stylelint trong CI
- Bên thứ 3/cộng đồng → bắt buộc Shadow DOM (`attachShadow({mode: 'closed'})`), không tin họ tuân thủ quy ước

**Khác biệt quan trọng với backend:** không có Cordis DI đứng sau UI Slot — sai tên khoá chỉ lặng lẽ không render (không throw như Cordis Proxy), nên cần script CI đối chiếu `tool_name` giữa `cordis.patch.yml` và `register.ts`.

---

## 8. Observability — OpenTelemetry + GenAI Semantic Conventions

**Tách bạch 2 hệ thống khác nhau:** Session Event Log (dữ liệu nghiệp vụ, đã có ở Storage) ≠ Observability Telemetry (dữ liệu vận hành, log/trace/metric) — không dùng chung 1 backend.

**Span hierarchy:**

```
invoke_agent (root, gắn session.id/user.id)
 ├── plugin_lifecycle (đo mount/dispose — debug composability thật)
 ├── chat (LLM call, attribute gen_ai.*)
 ├── execute_tool
 │    └── mcp.call (span con — vượt ranh giới process, phải tự propagate traceparent)
 └── sandbox.exec (span con — vượt ranh giới network)
```

**Nguyên tắc content:** prompt/completion là **span event** (lọc được ở Collector, không cần sửa code), không phải attribute (luôn export). Mặc định KHÔNG capture full content trong production — chỉ bật qua feature flag.

**Hạ tầng:** local — `docker compose` thêm `otel-collector` + `jaeger`; production — chỉ đổi exporter trong Collector config, không đổi code app.

---

## 9. Deploy — Docker

```yaml
services:
  backend:
    build: ./backend
    volumes:
      - ./backend/data:/app/data # BẮT BUỘC — không mất SQLite khi restart container
    environment:
      - PROFILE=local
  frontend:
    build: ./frontend
```

`/admin/swap-bundle` endpoint vẫn hoạt động trong container — hot-swap không cần restart container, đúng mục tiêu ban đầu.

---

## 10. Gap để đạt chuẩn production thật

**Lưu ý quan trọng:** bản thân dsh (0.1.0-rc.6) KHÔNG phải chuẩn production — DeepSeek tự nhận đây là developer preview, cam kết sẽ có breaking changes. Không lấy dsh làm mốc so sánh.

| Ưu tiên            | Hạng mục           | Còn thiếu                                                                                                                                                                  |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cao**            | Resilience         | Retry/backoff cho LLM call, circuit breaker cho tool, timeout riêng từng tool, graceful shutdown (SIGTERM → drain turn đang chạy)                                          |
| **Cao**            | Security           | Sandbox network egress policy thật (chưa chỉ cảnh báo), secrets management (Vault/Secrets Manager thay vì `.env`), input validation tool argument, rate limiting theo user |
| Trung bình         | Vận hành/scale     | Health/readiness probe, horizontal scaling (SQLite→Postgres/DynamoDB khi đa instance), sticky session                                                                      |
| Trung bình         | Version discipline | Lockfile pin Cordis cứng (đã cảnh báo, chưa enforce CI), `dump-config` CLI, semver cho bundle tự viết                                                                      |
| Thấp (làm khi cần) | Data lifecycle     | TTL/archive session cũ, backup/restore Storage, xoá dữ liệu theo yêu cầu                                                                                                   |
| Thấp (làm khi cần) | CI/CD              | Nối `check:contracts`/`plugin.spec.ts`/chaos test vào pipeline thật, staged rollout                                                                                        |

**Áp YAGNI:** team nhỏ, chưa nhiều người dùng thật → ưu tiên Resilience + Security trước (rẻ, rủi ro cao nếu bỏ qua). Scale/CI-CD/data lifecycle làm khi thực sự có nhu cầu, không làm trước "để phòng".
