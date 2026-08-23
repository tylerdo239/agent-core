# Plan xây dựng Core Agent trên Cordis — Temporal & Spatial Composability

## 0. Tái xác nhận: 2 yêu cầu của bạn là cơ chế lõi của Cordis, không phải tự build

| Yêu cầu bạn đặt ra                                                                                  | Tên chính thức trong Cordis | Cơ chế cung cấp sẵn                                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gỡ 1 thành phần → mọi thứ nó "cài" (listener, connection, cache, lock) tự thu hồi sạch, đúng thứ tự | **Temporal composability**  | Effect scoping — mọi đăng ký qua `ctx.on`, `ctx.provide`, service lifecycle đều gắn với 1 "fork scope"; huỷ scope = tự rollback theo thứ tự ngược lại lúc đăng ký |
| A cần B; B mất → A tự ngừng (không lỗi giữa chừng) → B quay lại → A tự kích hoạt lại                | **Spatial composability**   | `inject` — khai báo dependency quyết định thời điểm activate; Cordis tự suspend/resume plugin theo trạng thái dependency, không cần bạn viết try/catch thủ công   |

**Việc thật sự cần làm**: (1) định nghĩa đúng các service seam, (2) viết đúng `inject` cho từng plugin, (3) luôn đăng ký effect qua API của `ctx` (không bao giờ side-effect ngoài `ctx`), (4) viết test xác nhận 2 cơ chế này hoạt động đúng cho use-case Agent cụ thể của bạn. Plan chia theo đúng 4 việc này.

---

## Phase 0 — Setup source mới, dùng @deepseek-ai/cordis làm core (không clone dsh)

Cordis không phải thứ chỉ tồn tại bên trong dsh — nó là 1 framework độc lập, publish thẳng lên npm. dsh chỉ là 1 ứng dụng _dùng_ Cordis. Ta dựng repo riêng, cài Cordis làm dependency, tự tạo root `Context` của chính mình.

```bash
mkdir agent-core && cd agent-core
npm init -y
npm install @deepseek-ai/cordis
npm install -D typescript tsx vitest @types/node
npx tsc --init
```

```json
// package.json
{
  "type": "module",
  "dependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-mcp-client": "^0.1.0"
  },
  "devDependencies": {
    "typescript": "^5",
    "tsx": "^4",
    "vitest": "^2",
    "@types/node": "^22"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  }
}
```

Xác nhận Cordis chạy đúng trước khi viết plugin nghiệp vụ — ví dụ tối thiểu, minh hoạ đúng 2 cơ chế cốt lõi bạn cần (spatial qua `inject`, temporal qua fiber dispose):

```typescript
// src/sanity-check.ts
import { Context, Service } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context {
    counter: Counter;
  }
  interface Events {
    "app/ready"(message: string): void;
  }
}

class Counter extends Service {
  value = 0;
  constructor(ctx: Context) {
    super(ctx, "counter");
  }
  next() {
    return ++this.value;
  }
}

const greeter = Object.assign(
  (ctx: Context) => {
    ctx.on("app/ready", (message) => {
      ctx.logger.info("%s #%d", message, ctx.counter.next());
    });
  },
  { inject: ["counter"] }, // spatial composability: chờ counter tồn tại mới activate
);

const root = new Context();
await root.plugin(Counter);
await root.plugin(greeter);
root.emit("app/ready", "started");
await root.fiber.dispose(); // temporal composability: mọi effect (listener) tự gỡ khi dispose
```

```bash
npx tsx src/sanity-check.ts
```

**Lưu ý quan trọng khác với plan clone dsh trước đây:** vì không dùng dsh, bạn **không có sẵn** `ctx.tools`, `ctx.sessions`, `ctx.web`, MCP client wiring, Web UI, Trajectory view — toàn bộ những thứ đó là tính năng của **ứng dụng dsh**, không phải của **framework Cordis**. Bạn phải tự viết seam + provider cho từng cái mình cần (đúng nội dung Phase 1 trở đi dưới đây). Đổi lại, bạn có 1 core gọn, không mang theo phần thừa của dsh mà bạn không dùng tới.

**Deliverable Phase 0:** `sanity-check.ts` chạy được, log ra đúng thứ tự, `fiber.dispose()` không còn listener nào sống sót (kiểm bằng cách emit lại `app/ready` sau dispose — không còn log nào xuất hiện).

---

## Phase 1 — Định nghĩa Capability Seam (Service Definition trước, Provider sau)

Mỗi seam = 1 interface cố định + tối thiểu 1 provider implement nó. Định nghĩa **trước khi viết bất kỳ tool nào**, vì đây là hợp đồng mà spatial composability dựa vào.

```
Seam                Interface (ctx.<key>)     Provider ví dụ trong plan này
─────────────────────────────────────────────────────────────────
Model                 ctx.llm                   llm-deepseek, llm-openai
Storage               ctx.storage               state-sqlite (dev), state-postgres (prod)
Memory                ctx.memory                memory-vector (lưu trữ & truy xuất ngữ cảnh dài hạn)
Tool registry         ctx.tools                 (built-in, dsh cung cấp sẵn)
Permission            ctx.permission            permission-rbac
Sandbox               ctx.sandbox               sandbox-local, sandbox-remote
Subagent registry     ctx.subagents             subagent-manager
```

```typescript
// seams/storage.ts — Service Definition, KHÔNG chứa implementation
import { Context, Service } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context {
    storage: StorageService;
  }
}

export abstract class StorageService extends Service {
  constructor(ctx: Context) {
    super(ctx, "storage", true); // true = required — plugin nào inject ['storage'] sẽ CHỜ tới khi có
  }
  abstract appendEvent(sessionId: string, event: object): Promise<void>;
  abstract readEvents(sessionId: string): Promise<object[]>;
}
```

**Deliverable Phase 1:** file `seams/*.ts` cho mọi interface, chưa có implementation thật — build phải pass dù chưa có provider nào, xác nhận interface tách biệt hoàn toàn khỏi implementation.

---

## Phase 2 — Xây Temporal Composability: Service Provider với lifecycle rõ ràng

```typescript
// bundles/state-sqlite/index.ts
import { Context } from "@deepseek-ai/cordis";
import { StorageService } from "../../seams/storage";
import Database from "better-sqlite3";

class SqliteStorage extends StorageService {
  private db!: Database.Database;

  async start() {
    this.db = new Database(this.ctx.config.storagePath ?? "data/sessions.db");
    this.db.exec(`CREATE TABLE IF NOT EXISTS events (...)`);
    this.ctx.logger("state-sqlite").info("SQLite storage connected");
  }

  async stop() {
    this.db.close(); // ĐÂY là chỗ temporal composability áp dụng
    this.ctx.logger("state-sqlite").info("SQLite storage closed cleanly");
  }

  async appendEvent(sessionId: string, event: object) {
    this.db
      .prepare(`INSERT INTO events (session_id, payload) VALUES (?, ?)`)
      .run(sessionId, JSON.stringify(event));
  }

  async readEvents(sessionId: string) {
    return this.db
      .prepare(`SELECT payload FROM events WHERE session_id = ?`)
      .all(sessionId)
      .map((r: any) => JSON.parse(r.payload));
  }
}

export function apply(ctx: Context) {
  ctx.plugin(SqliteStorage);
}
```

**Điểm mấu chốt cho temporal composability đúng nghĩa:** mọi side-effect (mở connection, đăng ký listener, set interval, đăng ký tool) phải đi qua API của `ctx` — **không bao giờ** làm ngoài nó.

```typescript
// SAI — side-effect không được Cordis track, không tự rollback được
export function apply(ctx: Context) {
  const interval = setInterval(() => checkHealth(), 5000); // ❌ Cordis không biết interval này tồn tại
}

// ĐÚNG — Cordis tự huỷ khi plugin unload
export function apply(ctx: Context) {
  ctx.setInterval(() => checkHealth(), 5000); // ✅ effect gắn với fork scope, tự clear khi dispose
  ctx.on("session/turn-end", handleTurnEnd); // ✅ listener tự gỡ khi dispose
}
```

**Deliverable Phase 2:** viết `state-sqlite`, `llm-deepseek`, `permission-rbac` theo đúng pattern lifecycle này. Test: mount → unmount → assert connection/listener/interval đã sạch hoàn toàn (dùng `ctx.dispose()` rồi kiểm tra qua process handle, không còn timer nào sống).

---

## Phase 3 — Xây Spatial Composability: đúng ví dụ bạn đưa ra (Tool A cần B, Subagent C cần D)

```typescript
// bundles/tool-database-query/index.ts
import { Context } from "@deepseek-ai/cordis";

export const name = "tool-database-query";
export const inject = ["storage"]; // ← đây là toàn bộ cơ chế spatial composability

export function apply(ctx: Context) {
  // Hàm apply() này CHỈ chạy khi ctx.storage tồn tại
  // Nếu ctx.storage bị unmount SAU KHI plugin này đã chạy, Cordis tự dispose fork của plugin này
  // Nếu ctx.storage được mount lại, Cordis tự chạy lại apply() — KHÔNG lỗi, KHÔNG cần try/catch thủ công
  ctx.tools.add("query_database", async (sql: string) => {
    return await ctx.storage.query(sql);
  });

  ctx
    .logger("tool-database-query")
    .info("activated — storage dependency satisfied");
}
```

```typescript
// bundles/subagent-report-writer/index.ts — đúng ví dụ "subagent C cần permission service D"
import { Context } from "@deepseek-ai/cordis";

export const name = "subagent-report-writer";
export const inject = ["permission", "llm"];

export function apply(ctx: Context) {
  ctx.subagents.register("report-writer", {
    async run(task: string) {
      const allowed = await ctx.permission.check("report-writer", "generate");
      if (!allowed) throw new Error("permission denied");
      return await ctx.llm.complete(task);
    },
  });

  ctx.logger("subagent-report-writer").info("subagent activated");
}
```

**Kiểm chứng spatial composability — test bắt buộc phải viết:**

```typescript
// tests/spatial-composability.test.ts
import { Context } from "@deepseek-ai/cordis";
import * as toolDb from "../bundles/tool-database-query";
import * as stateSqlite from "../bundles/state-sqlite";

test("tool tự suspend khi storage bị gỡ, tự resume khi storage quay lại", async () => {
  const root = new Context();
  const storageFork = root.plugin(stateSqlite);
  root.plugin(toolDb);

  await root.start();
  expect(root.tools.has("query_database")).toBe(true); // đã activate vì storage có sẵn

  storageFork.dispose(); // gỡ storage giữa chừng
  await new Promise((r) => setTimeout(r, 0));
  expect(root.tools.has("query_database")).toBe(false); // tool tự suspend, KHÔNG throw lỗi ở đây

  root.plugin(stateSqlite); // mount lại storage
  await new Promise((r) => setTimeout(r, 0));
  expect(root.tools.has("query_database")).toBe(true); // tool tự resume
});
```

**Deliverable Phase 3:** ≥3 cặp dependency thật trong hệ thống của bạn (tool↔storage, subagent↔permission, loop↔llm) đều có test dạng trên pass — đây là bằng chứng thực sự bạn đạt được yêu cầu "tháo lắp không lỗi giữa chừng, tự resume", không phải chỉ đọc docs rồi tin nó hoạt động.

---

## Phase 4 — Agent Loop, reasoning core, và Tool Python (theo pattern đã bàn)

```typescript
// bundles/loop-default/index.ts
import { Context } from "@deepseek-ai/cordis";

export const name = "loop-default";
export const inject = ["llm", "storage", "tools"];

export function apply(ctx: Context) {
  ctx.loop.register("default", {
    async runTurn(session, userMessage) {
      let step = 0;
      while (step < session.maxSteps) {
        const response = await ctx.llm.complete(
          session.buildPrompt(userMessage),
        );
        await ctx.storage.appendEvent(session.id, {
          type: "model_message",
          content: response,
        });

        if (!response.toolCall) return response;

        const tool = ctx.tools.get(response.toolCall.name);
        const result = await tool.execute(response.toolCall.args);
        await ctx.storage.appendEvent(session.id, {
          type: "tool_result",
          result,
        });
        step++;
      }
    },
  });
}
```

Tool Python (web search, code analysis...) mount qua MCP client như đã trình bày ở phần trước — **không đổi gì so với ví dụ Google Search đã làm**, chỉ cần thêm `inject: []` (MCP tool thường không cần dependency nội bộ, tự chứa logic).

**Deliverable Phase 4:** 1 turn end-to-end chạy được: model → quyết định gọi tool Python (MCP) → ghi event vào SQLite → trả kết quả.

---

## Phase 5 — Chaos test cho "tháo lắp không restart hệ thống"

Đây là bài test tổng hợp xác nhận toàn bộ 3 yêu cầu ban đầu của bạn cùng lúc, trên hệ thống đang chạy thật (không phải unit test cô lập):

```typescript
// tests/chaos-hot-swap.test.ts
test("đổi loop driver giữa lúc có turn khác đang chạy, không restart, không crash", async () => {
  const app = await bootFullApp(); // boot toàn bộ hệ thống như production

  const longRunningTurn = app.sessions
    .create("session-1")
    .runTurn("research đề tài dài...");

  // Trong lúc turn trên đang chạy dở — swap loop driver khác
  await app.swapBundle("loop-default", "loop-planner-critic");

  const result = await longRunningTurn;
  expect(result).toBeDefined(); // session-1 hoàn tất KHÔNG lỗi (vì đã pin loop cũ)

  const newSession = app.sessions.create("session-2");
  const newResult = await newSession.runTurn("câu hỏi khác");
  expect(app.activeLoopBundle).toBe("loop-planner-critic"); // session-2 dùng loop MỚI
});
```

**Deliverable Phase 5:** test trên pass, chạy được nhiều lần liên tiếp không leak (dùng `--detectOpenHandles` của Jest để xác nhận không còn connection/timer nào sống sót sau nhiều vòng swap).

---

## Phase 6 — API Layer: REST, WebSocket (stream), gRPC

Core (Phase 0-5) chỉ chạy in-process — không có gì lắng nghe network. Phase
6 bọc core thành 1 backend service thật, expose qua 3 giao thức, dùng
**chung 1 core**, không nhân bản logic nghiệp vụ ra từng adapter. Nguyên tắc:
REST/WS/gRPC chỉ là **adapter mỏng** dịch request/response của từng giao
thức sang lời gọi vào `ctx.agent`/`ctx.sessions`/`ctx.storage` đã có sẵn —
không adapter nào được tự chứa business logic riêng.

### 6.0 — 2 seam mới cần trước khi viết adapter nào

**a) `ctx.sessions`** — REST là stateless-per-request, WS/gRPC là long-lived
connection; cả 3 cần 1 nơi DÙNG CHUNG để tạo/tra `Session` theo id, không tự
giữ session riêng từng adapter (adapter nào tự giữ session riêng = 2 client
qua 2 giao thức khác nhau không thấy cùng 1 cuộc hội thoại).

```typescript
// seams/sessions.ts
import { Context, Service } from "@deepseek-ai/cordis";
import { Session } from "./loop.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessions: SessionRegistryService;
  }
}

export abstract class SessionRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, "sessions");
  }
  abstract create(opts?: {
    id?: string;
    driver?: string;
    maxSteps?: number;
    systemPrompt?: string;
  }): Session;
  abstract get(id: string): Session | undefined;
  abstract list(): Session[];
}
```

**b) Sự kiện stream `agent/step`** — để WS/gRPC push từng bước của 1 turn
ra ngoài theo thời gian thực thay vì chỉ trả về kết quả cuối cùng, loop
driver (`loop-default`, `loop-planner-critic`) phát thêm 1 event Cordis
NGAY TẠI ĐÚNG CHỖ đã ghi `storage.appendEvent` (không thêm bước riêng, không
tách rời 2 nguồn sự thật):

```typescript
// seams/loop.ts — thêm
declare module "@deepseek-ai/cordis" {
  interface Events {
    "agent/step"(event: { sessionId: string; step: LoopStep }): void;
  }
}

export type LoopStep =
  | { type: "model_message"; content: string; toolCall?: LlmToolCall }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "final"; content: string };
```

```typescript
// bundles/loop-default — mỗi chỗ đã appendEvent, emit thêm:
await runCtx.storage.appendEvent(session.id, { type: "model_message", ... });
runCtx.emit("agent/step", { sessionId: session.id, step: { type: "model_message", ... } });
```

REST không cần nghe event này (chỉ trả kết quả cuối, đúng ngữ nghĩa
request/response). WS và gRPC (server-streaming RPC) đều nghe qua
`ctx.on('agent/step', ...)`, lọc theo `sessionId`, forward ra client — cùng
1 nguồn phát, 2 adapter tiêu thụ, không trùng lặp logic.

**Deliverable 6.0:** `seams/sessions.ts` + provider in-memory
(`bundles/session-registry`), `seams/loop.ts` phát `agent/step` đúng 3 điểm
(model_message, tool_result, final) — có test xác nhận nghe được event đúng
thứ tự cho 1 turn có tool call, KHÔNG cần adapter nào đã build.

### 6.1 — REST (`bundles/api-rest`)

HTTP server thật (`node:http`, không thêm framework — giữ đúng coding rule
A6, endpoint ít, không cần routing phức tạp), khởi động/đóng qua đúng
lifecycle đã dùng cho SQLite (`[Service.init]()` mở `server.listen()`, trả
về `() => server.close()`).

```typescript
// bundles/api-rest/index.ts
export const inject = ["sessions", "agent", "storage"];

// POST   /sessions                    -> { id, driver }
// POST   /sessions/:id/messages       -> { content, steps }   (chạy 1 turn, block tới khi xong)
// GET    /sessions/:id/events         -> { events: [...] }    (đọc lại từ ctx.storage)
// GET    /health                      -> { status: "ok" }
```

**Deliverable 6.1:** server thật lắng nghe port, test gọi bằng `fetch` thật
(không mock) — tạo session, gửi message, nhận kết quả, đọc lại event; mount →
unmount → cổng đã đóng sạch (cùng pattern lifecycle test đã dùng ở Phase 2).

### 6.2 — WebSocket streaming (`bundles/api-ws`)

Dùng package `ws` (server WebSocket chuẩn, nhẹ, không phụ thuộc framework
HTTP nào). Giao thức JSON 2 chiều trên 1 socket:

```
Client -> Server: { type: "create_session", driver?, maxSteps?, systemPrompt? }
Server -> Client: { type: "session_created", id, driver }

Client -> Server: { type: "send_message", sessionId, message, driver? }
Server -> Client: { type: "step", sessionId, step }        (0..N lần, real-time)
Server -> Client: { type: "done", sessionId, result }        (1 lần, cuối turn)
Server -> Client: { type: "error", message }                 (nếu có lỗi)
```

**Deliverable 6.2:** test dùng WebSocket client thật kết nối vào server thật
(không mock socket) — gửi `send_message`, thu đủ chuỗi `step` đúng thứ tự
rồi tới `done`, đúng bằng số event `agent/step` mà turn đó phát ra.

### 6.3 — gRPC (`bundles/api-grpc`) — build nếu cần polyglot/service-to-service, không bắt buộc cho web client

REST + WS đã đủ cho phần lớn client (web/mobile). gRPC chỉ thật sự cần khi
core này bị gọi từ 1 service khác viết ngôn ngữ khác (Go/Python/Java...)
trong hệ thống lớn hơn — quyết định build hay không nằm ở đó, không phải ở
năng lực kỹ thuật. Nếu build: dùng `@grpc/grpc-js` + `@grpc/proto-loader`
(load `.proto` runtime, không cần bước `protoc` codegen riêng — giữ toolchain
đơn giản).

```protobuf
// bundles/api-grpc/agent.proto
service AgentService {
  rpc CreateSession (CreateSessionRequest) returns (CreateSessionResponse);
  rpc SendMessage (SendMessageRequest) returns (SendMessageResponse);
  rpc StreamTurn (SendMessageRequest) returns (stream StepEvent); // tương đương WS
}
```

**Deliverable 6.3:** test dùng gRPC client thật (`@grpc/grpc-js`) gọi
`CreateSession`/`SendMessage`/`StreamTurn` vào server thật — không mock
transport.

### Nguyên tắc chung cho cả 3 adapter (áp dụng coding rule A1-A12 y hệt bundle nghiệp vụ)

- Mỗi adapter là 1 bundle độc lập, tự lifecycle (`[Service.init]` mở
  server, return đóng server) — mount/unmount không leak port, không leak
  connection, test bằng đúng pattern Phase 2.
- Adapter KHÔNG tự giữ state hội thoại — mọi state đi qua `ctx.sessions`
  dùng chung.
- Có thể mount cả 3 cùng lúc, chỉ 1, hoặc 0 — hệ thống core (Phase 0-5) chạy
  độc lập không cần adapter nào tồn tại (đúng tinh thần seam-first: transport
  là chi tiết implementation, không phải core).

**Deliverable Phase 6 (tổng):** boot `session-registry` + `api-rest` +
`api-ws` cùng lúc trên 1 `Context` — tạo session qua REST, gửi message +
nhận stream qua WS, đọc lại lịch sử qua REST — cùng 1 session, nhất quán qua
cả 2 giao thức. gRPC verify độc lập nếu được build.

### 6.4 — Production hardening (bắt buộc trước khi expose ngoài dev/test)

Phase 6.1-6.3 mở port lắng nghe network thật nhưng chưa có gì ngăn ai đó
ngoài dùng được. Mức tối thiểu cho triển khai **1 instance, mạng nội bộ**
(quyết định triển khai khác — multi-instance, internet-facing — cần xem lại
từng mục dưới đây trước khi build thêm, không suy rộng tự động):

- **`seams/auth.ts` + provider `auth-apikey`** — API key đơn giản, so khớp
  bằng `crypto.timingSafeEqual` (constant-time, tránh timing attack). Cả 3
  adapter `inject: [...,'auth']`, tự check ngay đầu request/handler — đúng
  tinh thần coding rule B1 (không giả định caller đã check hộ). REST: header
  `Authorization: Bearer <key>` (trừ `/health`, `/ready`). WS: check lúc
  `verifyClient` (handshake), từ chối bằng HTTP 401 trước khi nâng cấp lên
  WebSocket. gRPC: check qua metadata `authorization` ở đầu mỗi handler.
- **Giới hạn kích thước request** — REST giới hạn body (mặc định 1 MiB, trả
  `413` nếu vượt), WS giới hạn qua `maxPayload`, gRPC qua
  `grpc.max_receive_message_length`. Không có giới hạn = 1 request có thể ăn
  hết RAM process.
- **`/ready` tách khỏi `/health`** — `/health` = process còn sống, `/ready` =
  dependency chain (`sessions`/`agent`/`storage`) đã thật sự hội tụ.
  Orchestrator dùng `/ready` để quyết định route traffic.
- **Validate config bắt buộc lúc boot, `process.on('uncaughtException'/'unhandledRejection')`**
  — thiếu biến môi trường bắt buộc thì `exit(1)` ngay với lỗi rõ ràng, không
  boot nửa vời rồi fail âm thầm sâu bên trong 1 fiber.

**Ngoài scope của mục này** (chỉ build nếu quyết định triển khai đổi):
multi-instance cần Postgres (thay SQLite) + session store dùng chung như
Redis (thay in-memory session-registry); internet-facing cần thêm
rate-limiting + CORS; có hệ thống user/login thật đứng trước thì đổi API key
sang JWT.

**Deliverable 6.4:** test xác nhận 401 khi thiếu/sai key trên cả 3 giao
thức, 413 khi vượt giới hạn body, `/health` và `/ready` không cần key,
`serve.ts` thật `exit(1)` khi thiếu biến môi trường bắt buộc.

---

## Phase 7 — Web UI demo + Docker deployment

Mục tiêu: 1 chat UI tối giản (như webchat DeepSeek) để demo core mà không
cần Postman/curl, và đóng gói chạy bằng `docker compose up` — không đổi
kiến trúc core, chỉ thêm 1 adapter mới + hạ tầng triển khai.

### 7.1 — `bundles/adapters/web-ui`

UI là 1 bundle độc lập giống `api-rest`/`api-ws`/`api-grpc` — tự lifecycle
(`apply` async, mở server, return disposer), tự sở hữu port riêng. Khác biệt
duy nhất: bundle này **không inject seam nào** — nó chỉ serve static file
(HTML/CSS/JS) từ `node:http`, mọi logic nghiệp vụ (tạo session, gửi message,
nhận stream) chạy ở phía **browser**, gọi thẳng vào `api-rest`/`api-ws` như
1 client bên ngoài — đúng nguyên tắc "adapter không chứa business logic",
áp dụng luôn cho UI, không có ngoại lệ.

```typescript
// bundles/adapters/web-ui/index.ts
export const apply = async (ctx: Context, config: WebUi.Config = {}) => {
  const server = createServer((req, res) => serveStatic(req, res)) // đọc từ ./public
  await new Promise<void>((resolve) => server.listen(config.port ?? 8790, resolve))
  return () => new Promise<void>((resolve) => server.close(() => resolve()))
}
```

UI cần user tự nhập API key (giống Postman) — không hard-code key vào bundle
hay vào file tĩnh (key sẽ lộ ra qua view-source). Lưu trong `localStorage`
của trình duyệt, chỉ tồn tại phía client.

**2 vấn đề kỹ thuật phải xử lý trước khi UI thật gọi được vào REST/WS (đã
biết trước, không phải phát hiện giữa chừng khi build)**:

1. **CORS cho `api-rest`** — UI (port 8790) và REST (port 8787) là 2 origin
   khác nhau theo trình duyệt (khác port = khác origin). Không có CORS
   header, `fetch()` từ UI bị trình duyệt chặn — không liên quan gì đến
   internet-facing hay không (khác với rate-limiting/CORS đã defer ở mục
   6.4 vì lý do "mạng nội bộ" — CORS ở đây cần vì có **browser client**,
   một quyết định độc lập với việc mạng có public hay không). Thêm
   `Access-Control-Allow-Origin` + xử lý `OPTIONS` preflight vào
   `bundles/adapters/api-rest`.
2. **WebSocket từ browser KHÔNG set được custom header** — `new
   WebSocket(url)` theo Web spec không có tham số headers (khác hẳn client
   Node `ws` dùng trong test, có hỗ trợ). Cơ chế `Authorization` header lúc
   `verifyClient` ở Phase 6.4 chỉ đúng cho client Node, KHÔNG hoạt động từ
   browser thật. Sửa `bundles/adapters/api-ws`: `verifyClient` đọc thêm key
   từ **query string** (`ws://host:port/?key=...`) nếu không có header —
   giữ cả 2 đường (header cho client Node/test hiện có, query cho browser),
   không phải thay thế.

**Deliverable 7.1:** mở `bundles/adapters/web-ui/public/index.html` bằng
trình duyệt thật, nhập API key, tạo session, gửi message, thấy từng bước
(`model_message`/`tool_result`/`final`) hiện ra real-time qua WS — không
qua Postman/curl, đúng nghĩa "demo".

### 7.2 — Docker

1 image chạy toàn bộ `serve.ts` (core + REST + WS + gRPC + Web UI trong
CÙNG 1 process Node — không tách container riêng cho UI, vì UI chỉ serve
static file, tách ra là thêm phức tạp vận hành không cần thiết ở quy mô
demo/1-instance đã chốt ở Phase 6.4).

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev  # chạy bằng tsx — xem ghi chú "Rủi ro" bên dưới
COPY . .
VOLUME /app/data       # SQLite persist qua restart container
EXPOSE 8787 8788 8790 50051
CMD ["npx", "tsx", "src/serve.ts"]
```

`docker-compose.yml` bọc lại với `.env` (biến môi trường bắt buộc từ Phase
6.4: `DEEPSEEK_API_KEY`, `API_KEYS`), map port ra host, mount volume cho
`data/`.

**Deliverable 7.2:** `docker compose up --build` thật (không phải chỉ viết
Dockerfile rồi tin nó chạy) → `curl localhost:8787/health` trả `200` từ
NGOÀI container → mở UI ở `localhost:8790` từ trình duyệt host dùng được
đầy đủ như chạy `npm run serve` trực tiếp.

**Rủi ro cần ghi nhận:** image chạy bằng `tsx` (transpile lúc chạy) thay vì
build sẵn ra `dist/*.js` rồi chạy bằng `node` thuần — đơn giản hơn, rủi ro
thấp hơn (không cần thiết lập pipeline build TypeScript riêng, tránh lỗi
resolve `.ts`/`.js` khi emit), nhưng image lớn hơn (mang theo `tsx` +
`typescript` dù là runtime) và cold-start chậm hơn 1 chút do transpile lúc
chạy. Chấp nhận đánh đổi này ở quy mô demo/1-instance; nếu cần tối ưu image
production thật sự, đây là điểm quay lại làm build pipeline `tsc` riêng.

---

## Phase 8 — Production hardening round 2: session/history lifecycle, LLM retry, storage retention, UI plugin-driven rendering

Phase 6.4 xử lý bề mặt tấn công network (auth, giới hạn request). Phase 8 xử
lý 4 gap phát hiện qua audit production-readiness sau khi đã chạy thật bằng
Docker + LLM/search thật một thời gian — đều là loại lỗi **chỉ lộ ra khi chạy
dài hạn/nhiều request**, không lộ trong demo ngắn nên không bị bắt ở Phase
6-7:

1. `session-registry` giữ mọi session tạo ra **vĩnh viễn** trong `Map` — không
   có TTL/cleanup. Server chạy vài ngày/tuần → leak RAM từ session bị bỏ dở.
2. `Session.history` không giới hạn độ dài — mỗi turn gửi TOÀN BỘ lịch sử cho
   model. Hội thoại dài → tốn cost, có thể vượt context window.
3. `llm-qwen.complete()` chỉ có 1 lần `fetch` + timeout, không retry — 1 lỗi
   mạng thoáng qua (503, timeout, 429 từ proxy) fail thẳng cả turn.
4. `state-sqlite` không có retention — bảng `events` ghi mãi mãi, không có gì
   xoá/archive event cũ.

Đi kèm 1 thay đổi kiến trúc UI: tool-rendering trong `web-ui` hiện đang
**hardcode theo tên tool** (`TOOL_META['web_search']`, `if (name ===
'web_search')`) — vi phạm đúng tinh thần seam-first (UI biết chi tiết nội bộ
của 1 tool cụ thể thay vì tool tự khai báo cách hiển thị của chính nó). Sửa
để UI **plugin-driven**: tool tự khai `ui` hint lúc đăng ký, UI chỉ đọc hint
đó, không biết tên tool cụ thể nào.

### 8.1 — `ctx.sessions`: TTL + sliding cleanup

`seams/sessions.ts` thêm `abstract remove(id: string): boolean`.
`bundles/providers/session-registry` đổi sang lưu `{ session, lastActiveAt }`,
nhận config `{ ttlMs?, sweepIntervalMs? }` (default 30 phút / 1 phút).
`get(id)` cập nhật `lastActiveAt` mỗi lần gọi (TTL **trượt theo hoạt động**,
không phải tính từ lúc tạo — session đang chat liên tục không bị xoá giữa
chừng). Sweep định kỳ qua `ctx.effect(() => { const id = setInterval(...);
return () => clearInterval(id) })` — đúng coding rule A2, không `setInterval`
thô.

**Deliverable 8.1:** test tạo session với `ttlMs`/`sweepIntervalMs` nhỏ (vd.
50ms/20ms) — session không được `get()` sau `ttlMs` bị sweep xoá khỏi
`list()`; session được `get()` liên tục trước hạn thì sống sót (verify TTL
trượt, không phải TTL cứng từ lúc tạo). Mount → unmount → interval sweep dọn
sạch (cùng pattern A4).

### 8.2 — `Session.history`: sliding window

`seams/loop.ts`, `Session` thêm tham số `maxHistoryMessages = 40` (constructor
+ `CreateSessionOptions.maxHistoryMessages`, cùng pattern với `maxSteps` đã
có — optional per-session, không cần biến môi trường riêng). Sau mỗi lần push
vào `history` (`buildPrompt`/`recordAssistant`/`recordToolResult`), trim: giữ
message `system` đầu tiên (nếu có) + `maxHistoryMessages - 1` message gần
nhất, bỏ phần cũ ở giữa.

Trim theo **số message thô**, không theo "turn" hoàn chỉnh — an toàn ở đây vì
`llm-qwen`/`llm-deepseek` đã đơn giản hoá role `'tool'` xuống `'user'` có tiền
tố (không track `tool_call_id`, xem mục "Ngoài phạm vi"), nên history gửi lên
API không có ràng buộc cấu trúc phải giữ nguyên cặp tool_call/tool_result —
cắt giữa chừng 1 cặp không tạo ra request không hợp lệ, chỉ mất 1 phần ngữ
cảnh cũ (đánh đổi chấp nhận được, không phải bug). Đây KHÔNG phải
summarization (không gọi thêm LLM để tóm tắt phần bị cắt) — sliding window
đơn thuần, đúng mức YAGNI cần cho gap đã phát hiện, không xây hạ tầng
summarization chưa ai yêu cầu.

**Deliverable 8.2:** test tạo session với `maxHistoryMessages` nhỏ, đẩy quá số
đó qua `buildPrompt`/`recordAssistant`/`recordToolResult` — `history.length`
không vượt cap, message `system` đầu vẫn còn nguyên.

### 8.3 — `llm-qwen`: retry với backoff cho lỗi transient

`LlmQwen.Config` thêm `maxRetries` (default 2 — tối đa 3 lần gọi),
`retryBaseDelayMs` (default 300ms, backoff nhân đôi mỗi lần:
`base * 2^attempt`). Retry CHỈ cho lỗi transient thật:

- `fetch` throw (network error, DNS fail, connection reset, abort/timeout).
- Response status `429` hoặc `5xx`.

KHÔNG retry `4xx` khác (400/401/403/404...) — request sai/auth sai sẽ fail y
hệt lần nữa, retry chỉ tốn thêm latency. Mỗi lần retry log qua
`ctx.logger('llm-qwen').warn(...)` (B7) để phân biệt được "chậm vì retry" với
"model chậm thật" lúc debug production.

**Đánh đổi cần biết:** timeout cũng nằm trong danh sách retry — nếu proxy
chậm thật (không phải lỗi thoáng qua), tổng latency tối đa có thể gấp tới
`(maxRetries + 1)` lần `timeoutMs` (default 60s × 3 = tối đa 3 phút). Chấp
nhận được ở default hiện tại vì ưu tiên "đừng fail cả turn vì 1 lần mạng
chập chờn" hơn "trả lời nhanh khi model thật sự quá tải" — đổi `maxRetries: 0`
nếu deployment cụ thể cần ngược lại.

**Deliverable 8.3:** test dùng `global.fetch` giả (không gọi mạng thật) — case
503 → 503 → 200 xác nhận đúng 3 lần gọi + kết quả cuối đúng; case 401 xác
nhận CHỈ 1 lần gọi (không retry); case network-error → network-error → 200
xác nhận retry cả lỗi throw trước khi có response.

### 8.4 — `state-sqlite`: retention theo thời gian

`SqliteStorage.Config` thêm `retentionDays?` (KHÔNG set = không prune gì, giữ
đúng hành vi hiện tại — backward compatible, không âm thầm xoá dữ liệu của ai
chưa yêu cầu) và `retentionSweepIntervalMs?` (default 1 giờ). Nếu
`retentionDays` được set: `[Service.init]()` thêm 1 `ctx.effect()` sweep định
kỳ chạy `DELETE FROM events WHERE created_at < unixepoch() - retentionDays *
86400`.

**Deliverable 8.4:** test insert event, chỉnh `created_at` thẳng qua SQL thô
về quá khứ (không đợi ngày thật), mount với `retentionDays`/
`retentionSweepIntervalMs` nhỏ — event cũ bị prune, event mới giữ nguyên.
Không set `retentionDays` → event cũ KHÔNG bị xoá (xác nhận backward
compatible).

### 8.5 — UI plugin-driven: tool tự khai cách hiển thị, UI không hardcode theo tên

`seams/tools.ts`, `ToolDefinition` thêm field optional `ui?: ToolUiHint`
(`{ icon?, label?, render?: 'citations' | 'io' }`) — metadata hiển thị thuần,
không phải logic nghiệp vụ, tool không khai coi như dùng fallback chung
(icon 🔧, label = tên tool, render 'io'). `seams/loop.ts`, `LoopStep` biến thể
`model_message` và `tool_result` thêm `toolUi?: ToolUiHint`. `loop-default`/
`loop-planner-critic` tra `runCtx.tools.get(name)?.ui` ngay lúc phát step,
gắn vào `toolUi` — KHÔNG phải state mới, chỉ forward metadata đã có sẵn trên
`ToolDefinition`.

`tool-web-search` khai `ui: { icon: '🔍', label: 'Tìm kiếm web', render:
'citations' }`; `tool-database-query` khai `ui: { icon: '🗄️', label: 'Tra dữ
liệu' }` (không khai `render` → mặc định `'io'`).

`bundles/adapters/api-grpc/agent.proto` thêm field `tool_ui_json` vào
`StepEvent` (cùng pattern JSON-string như `tool_result_json`) — giữ 3 adapter
đồng nhất, không để WS là adapter duy nhất mang được metadata này.

`bundles/adapters/web-ui/public/app.js`: xoá `TOOL_META` (bảng tra cứu
hardcode theo tên) và nhánh `if (name === 'web_search')` trong
`renderToolResult` — đọc trực tiếp `step.toolUi` (đến từ server, không phải
suy đoán từ tên tool phía client). Tool mới thêm sau này tự động có UI hợp lý
(fallback chung) mà không cần sửa `app.js`; muốn UI đẹp hơn thì tool tự khai
`ui`, không phải vá thêm 1 nhánh `if` mới trong client.

**Deliverable 8.5:** test `agent-loop`/`api-ws`/`api-grpc` xác nhận `toolUi`
(`tool_ui_json` bên gRPC) đúng với `ui` đã khai trên tool tương ứng, rỗng/
`undefined` cho tool không khai. Verify UI thật qua Docker: `web_search` vẫn
hiện citation list, `query_database` vẫn hiện card IN/OUT, cả hai không còn
qua bất kỳ điều kiện hardcode tên tool nào trong `app.js`.

### Rule kiến trúc rút ra (ghi vào coding rules)

Cả 4 gap 8.1-8.4 cùng 1 nguyên nhân gốc: **provider giữ state sống lâu hơn 1
request (in-memory hoặc trên đĩa) không có câu trả lời cho "cái gì khiến nó
không lớn vô hạn"**. Ghi thành coding rule A14 trong
`docs/agent-core-cordis-coding-rules.md` để PR sau này bị chặn sớm hơn, không
phải đợi tới lúc audit mới phát hiện lại.

**Deliverable Phase 8 (tổng):** 4 test file mới (hoặc mở rộng file có sẵn)
pass thật, `npm run typecheck` sạch, `docker compose up --build` lại, verify
UI thật qua trình duyệt/`curl` như các phase trước — không chỉ tin code mới
"chắc chạy đúng".

---

## Phase 9 — Web UI: slot-registry thật (parity cấu trúc với dsh), React + Vite

### 9.0 Vì sao đổi khỏi Phase 7/8.5 (metadata-driven), quyết định đã chốt

Phase 8.5 làm `ToolDefinition.ui` (icon/label/render-kind cố định) — đủ để
UI không hardcode theo TÊN tool, nhưng vẫn là **chọn giữa vài kiểu hiển thị
có sẵn**, không phải **tool tự ship code hiển thị riêng**. Đọc source thật
của dsh (`packages/client/ui-slots/src/index.ts`, `packages/client/ui-tool/
src/client/contract/slots.ts`, `packages/client/ui-tool/tests/toolview-slot.
client.spec.tsx` — verify qua GitHub API, không suy đoán từ tên package) xác
nhận dsh có 1 seam Cordis thật `ctx.slots` cho phép **bất kỳ plugin nào đăng
ký hẳn 1 React component thật** vào 1 điểm dispatch có key
(`ctx.slots.register({ name: 'tool.call.toolview', key: 'bash' }, BashCard)`),
fallback về `GenericToolCard` nếu tool không đăng ký gì — code-registration
thật, không phải metadata. Đây là khác biệt VỀ LOẠI, không phải về mức độ,
so với Phase 8.5.

Quyết định: build lại `ctx.slots` thật (không phải bản khoác vỏ) — nhưng
**có chủ đích đơn giản hoá** so với bản dsh đầy đủ ở những chỗ dsh cần cho
quy mô 60+ package/i18n mà agent-core chưa có nhu cầu thật thứ 2 (coding
rule A6 YAGNI vẫn áp dụng dù đang "clone architecture", không phải lý do để
bỏ qua): bỏ `chain` kind (routing qua selector — chưa có use-case 2 registrant
tranh nhau 1 vị trí), bỏ store-seat/locale-injection compartment (chưa có
state dùng chung xuyên nhiều slot, chưa có i18n). Giữ đúng phần lõi tạo nên
sự khác biệt thật: `single`/`list`/`keyed`, đăng ký = component thật, fallback
bắt buộc, dispose qua Cordis effect, subscribe cho re-render.

**Hệ quả kiến trúc lớn nhất, ghi rõ ngay từ đầu**: UI-plugin cần 1 CÂY CORDIS
RIÊNG chạy trong TRÌNH DUYỆT (không phải cây `root` của `src/serve.ts` chạy
trên server) — dsh có 2 cây Cordis độc lập (server harness + client UI runtime
trong `packages/client/runtime`), agent-core cũng cần y hệt. `web-ui` không
còn chỉ "serve static file" — nó serve 1 build artifact (React app) mà bên
trong tự mount 1 `new Context()` của chính nó.

### 9.1 `packages/ui-slots` — slot registry lõi (framework-agnostic, không phụ thuộc React/Cordis) — ĐÃ BUILD

**2 chỗ khác bản nháp dưới đây, phát hiện lúc implement thật (không phải chỉ
chép code rồi tin đúng)**: (1) `order` từng chỉ là field khai báo, không ai
dùng — `entries()` giờ SẮP XẾP theo `order` cho slot kind `'list'` (mặc định
0, sort ổn định nên cùng order giữ đúng thứ tự đăng ký); (2) kind `'single'`
chưa có ràng buộc gì trong bản nháp — `register()` giờ throw nếu slot
`'single'` đã có 1 entry, nhất quán với hành vi `'keyed'` (fail rõ ràng thay
vì âm thầm cho 2 registrant tranh nhau 1 vị trí "chỉ có 1"). Code dưới đây đã
cập nhật khớp với `packages/ui-slots/src/core.ts` thật.

TypeScript thuần, port lại đúng phần lõi của `SlotCore` thật (đơn giản hoá
theo 9.0):

```typescript
// packages/ui-slots/src/core.ts
export type SlotKind = 'single' | 'list' | 'keyed'

export interface SlotEntry<P = any> {
  component: (props: P) => unknown // ReactNode — package này KHÔNG import React, giữ zero-dependency như dsh
  key?: string // bắt buộc nếu slot kind = 'keyed'
  id?: string // bắt buộc nếu slot kind = 'list'
  order?: number
  registrant?: string // tên bundle đăng ký — debug (coding rule B7 áp dụng cả UI-plugin)
}

export class SlotCore {
  private slots = new Map<string, { kind: SlotKind; entries: SlotEntry[] }>()
  private listeners = new Map<string, Set<() => void>>()

  declare(name: string, kind: SlotKind) {
    if (this.slots.has(name)) throw new Error(`slot "${name}" already declared`)
    this.slots.set(name, { kind, entries: [] })
  }

  register<P>(name: string, entry: SlotEntry<P>): () => void {
    const slot = this.slots.get(name)
    if (!slot) throw new Error(`slot "${name}" is not declared`)
    if (slot.kind === 'keyed' && !entry.key) throw new Error(`keyed slot "${name}" requires entry.key`)
    if (slot.kind === 'list' && !entry.id) throw new Error(`list slot "${name}" requires entry.id`)
    if (slot.kind === 'keyed' && slot.entries.some((e) => e.key === entry.key)) {
      throw new Error(`slot "${name}" already has an entry for key "${entry.key}"`)
    }
    if (slot.kind === 'single' && slot.entries.length > 0) {
      throw new Error(`slot "${name}" is a 'single' slot and already has a registrant`)
    }
    const stored = entry as SlotEntry
    slot.entries = [...slot.entries, stored]
    this.notify(name)
    return () => {
      slot.entries = slot.entries.filter((e) => e !== stored)
      this.notify(name)
    }
  }

  entries(name: string): readonly SlotEntry[] {
    const slot = this.slots.get(name)
    if (!slot) return []
    if (slot.kind !== 'list') return slot.entries
    // Sort ổn định — entry cùng `order` (mặc định 0) giữ đúng thứ tự đăng ký.
    return [...slot.entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  subscribe(name: string, fn: () => void): () => void {
    const set = this.listeners.get(name) ?? new Set()
    set.add(fn)
    this.listeners.set(name, set)
    return () => set.delete(fn)
  }

  private notify(name: string) {
    for (const fn of this.listeners.get(name) ?? []) fn()
  }
}
```

**Deliverable 9.1: ĐÃ XONG** — `packages/ui-slots/{package.json,src/core.ts,tests/core.test.ts}`,
9 test thuần (không cần React/Cordis) pass thật: declare-trùng-tên-throw,
register-vào-tên-chưa-declare-throw, keyed (thiếu key/trùng key throw, đúng
entry theo key), list (thiếu id throw, sort theo `order` + giữ thứ tự đăng
ký khi cùng order), single (đăng ký lần 2 throw), entries() rỗng khi chưa ai
đăng ký, dispose() qua giá trị trả về của `register()` xoá đúng entry + notify
subscriber, subscribe() theo đúng tên slot (không broadcast chéo). `npm test`
55/55 pass, `npm run typecheck` sạch (đã thêm `packages` vào `include` của
`tsconfig.json`).

### 9.2 `ctx.slots` — bọc `SlotCore` thành seam Cordis (client-side) — ĐÃ BUILD

```typescript
// packages/ui-slots/src/seam.ts
import { Context, Service } from '@deepseek-ai/cordis'
import { SlotCore, SlotEntry, SlotKind } from './core.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { slots: SlotRegistryService }
}

export abstract class SlotRegistryService extends Service {
  constructor(ctx: Context) { super(ctx, 'slots') }
  abstract declare(name: string, kind: SlotKind): void
  // Coding rule A2: disposer trả về PHẢI được gắn qua ctx.effect() bởi
  // NGƯỜI GỌI (tool UI plugin) — đúng pattern ToolRegistryService.add đã có.
  abstract register<P>(name: string, entry: SlotEntry<P>): () => void
  abstract entries(name: string): readonly SlotEntry[]
  abstract subscribe(name: string, fn: () => void): () => void
}

export class SlotRegistry extends SlotRegistryService {
  private core = new SlotCore()
  declare(name: string, kind: SlotKind) { this.core.declare(name, kind) }
  register<P>(name: string, entry: SlotEntry<P>) { return this.core.register(name, entry) }
  entries(name: string) { return this.core.entries(name) }
  subscribe(name: string, fn: () => void) { return this.core.subscribe(name, fn) }
}

export const apply = async (ctx: Context) => { await ctx.plugin(SlotRegistry) }
```

**Deliverable 9.2: ĐÃ XONG** — `packages/ui-slots/{src/seam.ts,tests/seam.test.ts}`,
4 test pass thật: mount qua `ctx.plugin()` rồi thao tác hoàn toàn qua
`ctx.slots.*` (không truy cập instance trực tiếp), mount → unmount →
`ctx.reflect.get('slots', false)` trả `undefined` (đúng pattern A4), mount
lại sau unmount tạo instance MỚI không rò rỉ state (slot cũ declare() lại
được, không throw "already declared"), subscribe() nhận đúng notify qua
register()/dispose() gọi qua seam. Hành vi thân `SlotCore` (declare/register/
entries/keyed/list/single) đã test đủ ở 9.1, test 9.2 chỉ verify phần WIRING,
không lặp lại. `npm test` 59/59 pass, `npm run typecheck` sạch.

### 9.3 `packages/ui-react` — binding React (`useSyncExternalStore`) — ĐÃ BUILD

**Khác bản nháp dưới đây, phát hiện lúc implement thật:**
1. Import cross-package `@agent-core/ui-slots` (bare specifier) CHƯA resolve
   được — `packages/` chưa nằm trong npm workspaces (việc của 9.6), không có
   tsconfig `paths` + resolver alias tương ứng cho cả `tsc` lẫn `vitest`/
   `tsx`. Dùng relative import (`../../ui-slots/src/core.ts`) — đúng
   convention cross-thư-mục đã dùng xuyên suốt repo (`seams/`, `bundles/`).
   Đổi sang bare import khi 9.6 dựng workspaces xong (chỉ đổi câu import).
2. `RenderSlot<Owner>` cần ràng buộc `Owner extends object` — generic không
   ràng buộc làm `tsc` lỗi `TS2322` khi spread `{...owner}` vào JSX
   (`Owner` không chắc tương thích `IntrinsicAttributes`).
3. **Quan trọng nhất**: `RenderSlot` PHẢI dùng JSX thật (`<Component
   {...owner} />`), KHÔNG được gọi trực tiếp `Component(owner)` như hàm
   thường — nếu gọi trực tiếp, hook bên trong `Component` (nếu có
   `useState`/`useEffect`) chạy như thể thuộc về chính fiber của
   `RenderSlot`, không có fiber/identity riêng. Khi slot đổi từ component A
   sang component B (hot-swap 1 UI-plugin), React không unmount đúng state
   cũ của A trước khi "mount" B — vi phạm rule hook "gọi cùng thứ tự mỗi
   lần render" ngay khi 2 component có hook khác nhau. Đây là bug tinh vi
   chỉ lộ ra khi có UI-plugin thật dùng state riêng, không lộ trong ví dụ
   đơn giản — cố tình giữ JSX thật ngay từ đầu, không tối ưu "gọn hơn" bằng
   cách gọi hàm trực tiếp.

```typescript
// packages/ui-react/src/useSlot.ts
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SlotEntry } from '../../ui-slots/src/core.ts'

export function useSlotEntries(ctx: Context, name: string): readonly SlotEntry[] {
  return useSyncExternalStore(
    (onChange) => ctx.slots.subscribe(name, onChange),
    () => ctx.slots.entries(name),
  )
}
```

```tsx
// packages/ui-react/src/RenderSlot.tsx
export interface RenderSlotProps<Owner extends object> {
  ctx: Context
  name: string
  entryKey?: string
  owner: Owner
  fallback: (props: Owner) => ReactNode
}

export function RenderSlot<Owner extends object>({ ctx, name, entryKey, owner, fallback }: RenderSlotProps<Owner>) {
  const entries = useSlotEntries(ctx, name)
  const entry = entryKey === undefined ? entries[0] : entries.find((e) => e.key === entryKey)
  const Component = (entry?.component ?? fallback) as (props: Owner) => ReactNode
  return <Component {...owner} />
}
```

`RenderSlot` (component tiện ích, tương đương `renderSlot()` bên dsh):
nhận `ctx`, `name`, `entryKey?`, `owner` (props truyền cho entry tìm được),
`fallback` (component dùng khi không tìm thấy entry khớp `entryKey` — **bắt
buộc phải truyền**, không có mặc định ngầm, để không có slot nào crash cả
trang vì thiếu registrant). CHỦ ĐÍCH chưa hỗ trợ render toàn bộ entries của 1
slot `'list'` (kiểu toolbar nhiều registrant cùng hiện) — chưa có consumer
thật nào cần (coding rule A6), slot duy nhất đang dùng (`tool.call.toolview`)
là `'keyed'`.

**Deliverable 9.3: ĐÃ XONG** — `packages/ui-react/{package.json,src/{useSlot.ts,RenderSlot.tsx,index.ts},tests/RenderSlot.test.tsx}`,
3 test dùng `@testing-library/react` + `jsdom` pass thật (environment `jsdom`
khai qua docblock `// @vitest-environment jsdom` CHỈ cho file này, không đổi
environment mặc định `node` của các test khác): slot có registrant render
đúng component đó, không render fallback; slot không có entry khớp
`entryKey` render fallback, không throw; **gỡ 1 UI-plugin qua 1 fiber CON
riêng LÚC APP ĐANG CHẠY (không remount cây React cha, `view` vẫn là cùng 1
lần `render()` ban đầu) → UI tự chuyển sang fallback** — phép thử thật cho
"hot-swap ở tầng UI", cùng tinh thần chaos test Phase 5 nhưng cho slot thay
vì loop driver. 1 lỗi thật gặp khi viết test: RTL không tự dọn DOM giữa các
`it()` trong cùng file khi project chưa bật `test.globals`/setupFiles — phải
tự `afterEach(cleanup)`, nếu không `screen.getByTestId` match nhiều node từ
test trước còn sót lại, fail sai lý do. Thêm `react`/`react-dom` (dependencies)
và `@testing-library/react`/`jsdom`/`@types/react`/`@types/react-dom`
(devDependencies) vào `package.json` gốc — chưa tách qua workspace riêng
(việc của 9.6), `tsconfig.json` thêm `"jsx": "react-jsx"`. `npm test` 62/62
pass, `npm run typecheck` sạch.

### 9.4 `apps/web` — Vite + React, chat UI dựng lại thành cây component — ĐÃ BUILD

Dựng `apps/web` (Vite + React) SONG SONG với `bundles/adapters/web-ui/public/
{index.html,app.js,style.css}` cũ — CHƯA xoá file cũ (đúng deliverable gốc:
xoá sau khi có regression test thủ công qua trình duyệt thật xác nhận đúng
hành vi, việc đó cần user tự làm vì môi trường build này không có trình
duyệt). Giao thức REST/WS/gRPC giữ NGUYÊN, không đổi API backend.

**Khác bản nháp trong build plan, phát hiện lúc implement thật:**
1. Không có package `ui-conversation` riêng — chat list (danh sách tin nhắn)
   chỉ có ĐÚNG 1 consumer (`App.tsx`), tách thành package riêng là premature
   abstraction (coding rule A6). Toàn bộ state hội thoại (`ChatItem[]`) sống
   trực tiếp trong `App.tsx`.
2. `createClientContext()` **PHẢI async** — verify thực nghiệm (script repro
   riêng trước khi viết `App.tsx`): `ctx.plugin(uiSlots)` KHÔNG làm
   `ctx.slots` sẵn sàng đồng bộ ngay sau lệnh gọi (`apply` của seam 9.2 là
   `async`) — gọi `ctx.slots.declare(...)` ngay sau đó throw. Phải `await
   fiber.await()` trước — `App.tsx` mount cây Cordis client trong 1
   `useEffect` bất đồng bộ, `RenderSlot` chỉ render khi `clientCtx` đã có.
3. **Chrome chung của tool call (`ToolRow`, icon/title/summary/chevron/
   expand, sweep shimmer khi running) tách thành component RIÊNG trong
   `apps/web`, KHÔNG sống bên trong `GenericToolCard`** — đây là hạ tầng
   dùng chung cho MỌI tool call (kể cả tool có UI-plugin riêng ở 9.5),
   `GenericToolCard`/UI-plugin chỉ chịu trách nhiệm nội dung BODY khi mở
   rộng. Port đúng từ `createToolRow()`/`settleToolRow()` trong `app.js` cũ,
   phát hiện 1 chi tiết: CSS `.tool-row[data-state='error']
   .tool-row-header { cursor: pointer }` trong `style.css` cũ thực ra là
   dead code — `settleToolRow()` không bao giờ gắn click handler khi lỗi
   (`bodyNode` luôn `null`). Giữ đúng hành vi THẬT (chỉ state `'ok'`
   expandable), không giữ đúng CSS chết.
4. Vite dev server resolve cross-package import tương đối
   (`../../../packages/ui-slots/src/...`) tốt ngay lập tức, không cần
   workspaces/alias gì thêm (khác `tsc`, Vite tự xử lý qua resolver riêng) —
   xác nhận qua `npm run build:web` thật (production build) + `curl` từng
   file qua dev server, không chỉ tin "chắc chạy được".

`apps/web/src/client-context.ts` — tạo **1 `Context` Cordis RIÊNG chạy trong
trình duyệt** (không liên quan cây `root` của `src/serve.ts`), mount
`ui-slots`, `declare('tool.call.toolview', 'keyed')`. Phase 9.5 sẽ thêm UI-
plugin của tool vào đây — **mount tường minh, liệt kê rõ từng cái, không
auto-discover qua quét thư mục** (coding rule A16).

`apps/web/src/App.tsx` — cây component chính: state React cho tin nhắn/
session/kết nối WS (port từ `renderStep()`/`addMessage()` thủ công trong
`app.js` cũ), `RenderSlot<ToolViewOwnerProps>` (Phase 9.3) đặt bên trong
`<ToolRow>` tại đúng chỗ turn có tool call, `fallback={GenericToolCard}`.

`GenericToolCard` (fallback bắt buộc, sống sẵn trong `apps/web`, không phải
1 package riêng) đọc `toolUi.render` — `'citations'` → danh sách trích dẫn
đánh số, mặc định (`'io'`) → card IN/OUT — port từ `buildSearchSources()`/
`buildIoCard()` trong `app.js` cũ. Đơn giản hoá 1 chỗ: citations rỗng giờ
hiện "không tìm thấy kết quả" NGAY trong body thay vì gỡ hẳn chevron (app.js
cũ trả `bodyNode: null`) — đổi lấy code đơn giản hơn (`ToolRow` không cần
biết body "có rỗng không"), đánh đổi UX chấp nhận được. Tool KHÔNG khai
UI-plugin riêng (đa số tool tương lai) vẫn hoạt động đúng qua đường này —
Phase 8.5 không bị vứt bỏ, trở thành lớp fallback của Phase 9.

**Deliverable 9.4: ĐÃ XONG (phần verify tự động được — xem lưu ý dưới về
phần cần trình duyệt thật):**
- `npm run typecheck` sạch (thêm `"jsx": "react-jsx"`, `"lib": ["ES2022",
  "DOM", "DOM.Iterable"]` vào `tsconfig.json`, thêm `apps` vào `include`).
- `npm run build:web` (Vite production build) thành công thật — 41 module
  transform sạch, output `dist/{index.html,assets/*.js,assets/*.css}`.
- `npm run dev:web` (Vite dev server) chạy được, `curl` từng file nguồn
  (`App.tsx`, `client-context.ts`, `GenericToolCard.tsx`, `ToolRow.tsx`,
  cross-package `packages/ui-react`/`packages/ui-slots`) trả `200`, transform
  đúng, không lỗi.
- **Smoke test tự động mới** (`apps/web/tests/App.smoke.test.tsx`, `jsdom` +
  `@testing-library/react`) — render `<App/>` THẬT (không mock React/Cordis),
  verify: chưa có API key → tự mở settings dialog; có API key sẵn trong
  `localStorage` → không mở dialog, tự thử kết nối. Bắt được 2 lỗi thật
  ngay lập tức: jsdom không implement `Element.scrollIntoView` và
  `HTMLDialogElement.showModal()/close()` (giới hạn môi trường test, browser
  thật có đủ cả 2) — stub trong test, KHÔNG thêm optional-chaining phòng thủ
  vào `App.tsx` cho API chuẩn luôn tồn tại ở môi trường thật.
- **CHƯA verify**: chat thật qua REST/WS thật trong trình duyệt (deliverable
  gốc yêu cầu "regression test thủ công so với hành vi `app.js` cũ") — môi
  trường build này không có trình duyệt, cần user tự mở `npm run dev:web` +
  `npm run serve` song song để xác nhận trước khi xoá file cũ.
- `npm test` 64/64 pass (thêm 2 test smoke `App.smoke.test.tsx`, từ 62 của
  Phase 9.3).

### 9.5 UI-plugin cho tool cụ thể — ví dụ `tool-web-search` — ĐÃ BUILD

`packages/ui-tool-web-search/{src/{WebSearchCard.tsx,WebSearchCard.css,index.ts},tests/index.test.tsx}`.
`WebSearchCard.tsx` là component React THẬT với **state cục bộ + 1 hành
động** — 2 thứ `ToolUiHint` (Phase 8.5, icon/label/render-kind cố định)
KHÔNG thể biểu diễn được, đây chính là điểm khác biệt VỀ LOẠI đã xác nhận ở
9.0: toggle xem/ẩn snippet TỪNG nguồn riêng (`useState<Set<number>>`), nút
"Mở tất cả (N) trong tab mới" (`window.open` cho mọi URL). CSS riêng
(`WebSearchCard.css`) đóng gói cùng package, dùng lại design token
(`--border`, `--text-dim`...) khai ở `apps/web/src/style.css :root` — coi đó
là hợp đồng dùng chung do app host cung cấp.

`packages/ui-tool-database-query` — **CHỦ ĐỘNG không đăng ký gì** (không tạo
package) — chứng minh đường fallback `GenericToolCard` hoạt động đúng cho
tool không có UI-plugin riêng (đa số tool tương lai), không phải thiếu sót.

`apps/web/src/client-context.ts` mount `uiToolWebSearch` tường minh (rule
A16) — `await fiber.await()` cho MỌI fiber mount ở đây, kể cả khi `apply`
trông có vẻ đồng bộ (không lặp lại đúng lớp bug timing đã gặp ở 9.4).

**Deliverable 9.5: ĐÃ XONG** — `packages/ui-tool-web-search/tests/index.test.tsx`,
4 test pass thật (jsdom + `@testing-library/react`, dùng WEBSEARCHCARD THẬT,
không phải component giả như test 9.3): key `web_search` render đúng
`WebSearchCard` (không phải `GenericToolCard`); **tương tác thật hoạt động**
— click "xem mô tả" toggle snippet, state cục bộ đúng; key `query_database`
(không có UI-plugin riêng, chủ đích) rơi về fallback, không throw; gỡ
UI-plugin GIỮA LÚC app đang chạy (hot-swap tầng UI) → tự rơi về fallback,
không crash, không cần remount cây React cha. `npm test` 68/68 pass.

### 9.6 Toolchain: npm workspaces + Vite (không đổi sang pnpm) — ĐÃ BUILD

dsh dùng pnpm workspace — agent-core **cố ý KHÔNG đổi package manager theo**:
npm workspaces (đã có sẵn từ Node, không thêm dependency ngoài) đạt đúng
capability cần mà không đổi công cụ đang dùng cho toàn bộ phần server. Đổi
sang pnpm chỉ vì dsh dùng pnpm là bắt chước bề mặt, không phải nhu cầu thật
(coding rule A6).

```json
// package.json (root)
{
  "workspaces": ["packages/*", "apps/*"]
}
```

`npm install` tạo đúng symlink `node_modules/@agent-core/{ui-slots,ui-react,
ui-tool-web-search,web}` — verify thật bằng `ls -la`, không chỉ tin
`workspaces` field là đủ. Sau đó đổi TOÀN BỘ import cross-package (đã dùng
relative path xuyên suốt 9.1-9.5, đúng như ghi chú "đổi khi 9.6 dựng
workspaces xong") sang bare specifier `@agent-core/*` — verify riêng cho cả
3 công cụ dùng để build/chạy code trong repo (không giả định đồng nhất):
`tsc --noEmit`, `vitest run`, `vite build` đều resolve đúng. `packages/
ui-slots` gộp `core.ts`+`seam.ts`+`tool-view.ts` qua 1 `src/index.ts` re-
export (1 entry point cho cả package, `package.json.main` trỏ vào đó).

**`bundles/adapters/web-ui/index.ts` đổi từ serve `./public` viết tay sang
serve `apps/web/dist`** (build output Vite) — 1 thay đổi kiến trúc quan
trọng không có trong bản nháp gốc: Vite build output có **thư mục con thật**
(`/assets/index-XXXX.js`), nên cơ chế chống path-traversal cũ
(`path.basename()` — chỉ hoạt động đúng với cấu trúc PHẲNG) phải đổi sang
**containment check** (`path.normalize` + `startsWith(DIST_DIR)`). Viết test
mới cho containment check thì phát hiện thêm: với input đi qua `new URL()`
(WHATWG URL parser tự "remove dot segments"), `..` RAW trong URL không bao
giờ còn sống sót tới code của mình để containment check phải xử lý — nhánh
403 gần như không bao giờ thật sự được kích hoạt bởi 2 kiểu tấn công phổ
biến (raw `../` bị URL parser tự dọn; encoded `%2F` không tự decode nên
thành 1 "tên file" vô hại) — vẫn giữ containment check như phòng thủ theo
lớp (rẻ, không sai), nhưng SỬA TEST để verify đúng điều thật sự cần verify
(không lộ file hệ thống nào, không phải "trả đúng status code 403 cụ thể").
`tests/web-ui.test.ts` viết lại: KHÔNG hardcode tên file JS/CSS (Vite build
ra tên có content-hash, đổi mỗi lần build) — đọc `index.html` thật để tìm
đúng tên file trước khi fetch, đúng cách trình duyệt thật làm.

**Bootstrapping**: `apps/web/dist` phải tồn tại TRƯỚC khi `bundles/adapters/
web-ui` phục vụ được gì — thêm script `pretest` (`npm run build:web`, npm tự
chạy trước `test`) để `npm test` luôn tự-đủ (self-contained) từ checkout
sạch, không cần nhớ bước build tay riêng.

**Dockerfile đổi** — 3 stage thay vì 2: `deps` (cài dependency, giờ cần copy
`package.json` của TỪNG workspace member trước `npm ci` — workspaces đòi hỏi
khớp với `package-lock.json`, thiếu 1 cái là `npm ci` fail) → `build-web`
(copy `packages/`+`apps/web/`, chạy `npm run build:web`) → `runtime` (copy
`node_modules`+`seams`+`bundles`+`src`+**chỉ** `apps/web/dist` từ stage
`build-web` — KHÔNG copy `apps/web/src`/`packages/*/src` vào runtime, server
không cần source phía client).

**Deliverable 9.6: ĐÃ XONG** — `docker compose build` thật thành công ngay
lần đầu (3 stage, npm workspaces resolve đúng trong container), `docker
compose up` thật: `/health` trả `200`, `/` (port 8790) trả đúng `index.html`
build từ Vite (title "Phase 9"), asset `.js`/`.css` serve đúng content-type,
404 cho file không tồn tại. **Verify end-to-end thật qua WS** (không chỉ
health check): hỏi "giá vàng SJC hôm nay" qua WS thật → model gọi
`web_search` thật → `toolUi.render: 'citations'` đúng key `web_search` (sẽ
dispatch đúng `WebSearchCard` thật trên trình duyệt) → câu trả lời thật dùng
kết quả search thật — cùng bài test đã dùng để verify Phase 8.5, giờ chạy
qua UI mới, backend không đổi API.

**CHƯA verify được** (không có trình duyệt trong môi trường build này): xác
nhận bằng mắt UI mới render đúng trong browser thật — user cần tự mở
`http://localhost:8790` sau `docker compose up` để xác nhận trước khi coi
Phase 9 là "production-ready" đầy đủ, không chỉ "build xanh + API đúng".
`bundles/adapters/web-ui/public/{index.html,app.js,style.css}` (Phase 7) giờ
là **file mồ côi** — không còn code nào đọc (`web-ui` đổi sang serve
`apps/web/dist`) — CHỦ ĐỘNG CHƯA XOÁ vì repo này không phải git repository
(xác nhận lúc bắt đầu session), xoá sẽ không có cách khôi phục nếu UI mới có
vấn đề chưa lộ ra qua test tự động. Xoá sau khi user xác nhận UI mới ổn qua
trình duyệt thật.

### Coding rule mới rút ra (ghi vào coding rules)

- **A15**: UI-plugin đăng ký vào `ctx.slots` phải bọc disposer qua
  `ctx.effect()` (như mọi registry khác — A2), và MỌI slot kind `keyed` phải
  có 1 fallback bắt buộc tại nơi render (không có mặc định ngầm) — 1 tool
  thiếu UI-plugin không được phép làm crash cả trang.
- **A16**: UI-plugin mount tường minh (import + `ctx.plugin(...)` liệt kê rõ
  trong `apps/web/src/client-context.ts`), không auto-discover qua quét
  thư mục/`package.json` — nhất quán với cách `src/serve.ts` mount bundle
  server-side, không tạo 2 triết lý mount khác nhau trong cùng 1 repo.

**Deliverable Phase 9 (tổng): ĐÃ XONG** — 68/68 test pass thật (18 file
test, từ 46 test/13 file ở Phase 8), `npm run typecheck` sạch, chat UI React
thật qua `apps/web` (dev server + production build + serve qua Docker đều
verify thật), `tool-web-search` có UI-plugin riêng thật (không phải
metadata), `tool-database-query` minh hoạ đường fallback, `docker compose
up --build` thật thành công, verify end-to-end qua WS thật với LLM/search
thật. Việc còn lại KHÔNG phải code: user tự mở trình duyệt xác nhận UI mới
trước khi xoá file cũ.

---

## Phase 10 — Clone design-system thật của dsh (token/layout/bubble/primitive) + rebrand bảng màu cam/trắng/đen

Phase 9 clone đúng CƠ CHẾ UI-plugin của dsh (`ctx.slots`). Phase 10 đi xa hơn:
clone phần **thị giác** (token màu/spacing, hình học bubble tin nhắn, nút bấm)
— rồi thay TOÀN BỘ token màu gốc của dsh bằng bảng màu chủ đạo mới: cam
**#F26F21**, nền trắng **#fff**, chữ đen **#222222**.

### 10.0 — Xác nhận thật đã đọc được (evidence, không suy đoán)

Đọc source thật `packages/client/` của dsh (30 package `ui-*`) qua GitHub,
xác nhận:

- **`ui-theme`** (`src/styles/design-platform.css`) — token màu 3 TẦNG, scope
  qua CSS custom property trên `body`/`body[data-ds-dark-theme]`:
  1. **static** (`--dsw-static-*`): thang màu THÔ (neutral, neutral-bluish,
     blue, red, green, amber, deepseek — mỗi thang ~10 bậc `50→900/1000`).
  2. **alias** (`--dsw-alias-*`): token NGỮ NGHĨA trỏ vào static
     (`bg-base`, `label-primary`, `border-l1..l4`, `button-primary-fill`,
     `state-error-primary`...) — **đây là tầng mọi component thật sự dùng**,
     không component nào chạm static trực tiếp.
  3. **specific** (`--dsw-specific-*`): token riêng theo chỗ dùng (`bubble`,
     `sidebar-fill`, `tooltip-bg`...).
  Light mode: `bg-base = white`, `label-primary` ≈ đen. Palette gốc dsh là
  **xanh dương** (`--dsw-static-deepseek-*`) — **không có cam sẵn**, phải tự
  build thang màu cam mới, không phải "đổi 1 biến".
- **`ui-primitives`**: bộ component dùng chung — `Button`, `Modal`,
  `Tooltip`, `Toast`, `Menu`, `Input`, `Pill`, `StateDot`, `HoverCard`,
  `DisclosureRow`, `ConnectionBanner`, `WebBlock` (đã port ở Phase 9),
  `JsonTree`, `DiffBlock`, `TerminalBlock`, `ReadBlock`, `SearchBlock`.
  `Button.tsx`+`.module.css`: dạng viên thuốc (`border-radius: 18px`,
  `height: 36px`), biến thể size `md`/`sm`.
- **`ui-layout`**: `AppFrame.tsx` — shell CSS Grid **3 cột** (sidebar/center/
  details) kéo-giãn được, nền `var(--dsw-alias-bg-base)`.
- **`ui-conversation`**: `MessageItem.tsx`+`.module.css` — bubble **user**:
  `border-radius: 22px`, `padding: 10px 16px`, nền
  `var(--dsw-specific-bubble)`, chữ `var(--dsw-alias-label-primary)`,
  `max-width: min(525px, 82%)`. **Assistant KHÔNG phải bubble** — render qua
  `AssistantMarkdown.tsx` riêng, chảy full-width (khác hẳn app hiện tại của
  mình, đang bọc CẢ 2 chiều bằng bubble — kế thừa từ bản vanilla JS Phase 7,
  chưa từng đúng pattern dsh).
- **`ui-brand-official`**: logo/wordmark chính hãng DeepSeek — **CHỦ ĐỘNG
  KHÔNG CLONE**, đây là tài sản thương hiệu riêng của họ, không liên quan gì
  tới "design system" (token/layout/component) mà Phase 10 muốn lấy.
- **Công nghệ styling**: **CSS Modules thật** (mỗi component có 1 file
  `.module.css` cạnh `.tsx`, có `css-modules.d.ts` cho type) — KHÔNG phải
  Tailwind, KHÔNG phải styled-components.
- **Không xác nhận được**: cơ chế toggle theme lúc runtime
  (`theme-settings.ts`/`boot-theme.ts` — chỉ thấy file tồn tại, chưa đọc nội
  dung — không cần cho Phase 10 vì agent-core chỉ có 1 theme, không cần toggle
  dark/light); chi tiết composer auto-resize (`input/machine.ts` — state
  machine phức tạp, chưa đọc đủ sâu, không chặn Phase 10).

### 10.1 `packages/ui-theme` — token 3 tầng, populate bằng bảng màu MỚI — ĐÃ BUILD

Port đúng KIẾN TRÚC 3 tầng (static → alias → specific), KHÔNG port giá trị
màu gốc của dsh (xanh dương) — thay bằng cam/trắng/đen. Đơn giản hoá có chủ
đích: dsh có ~7 thang static (neutral, neutral-bluish, blue, red, green,
amber, deepseek) — agent-core chỉ cần 3 (`neutral` cho nền/viền/chữ phụ,
`brand` cho cam thay `deepseek`, `error`/`success` gộp làm 1 thang state đơn
sắc mỗi loại thay vì scale đầy đủ 10 bậc — chưa có nhu cầu thật cho gradient
lỗi/thành công nhiều mức, coding rule A6).

```css
/* packages/ui-theme/src/tokens.css */
:root {
  /* static — thang màu thô */
  --static-neutral-0: #ffffff;
  --static-neutral-50: #f7f7f7;
  --static-neutral-100: #eeeeee;
  --static-neutral-200: #e0e0e0;
  --static-neutral-300: #cccccc;
  --static-neutral-400: #999999;
  --static-neutral-500: #757575;
  --static-neutral-600: #5c5c5c;
  --static-neutral-700: #444444;
  --static-neutral-800: #2e2e2e;
  --static-neutral-900: #222222; /* == chữ đen bạn chỉ định */

  --static-brand-50: #fef3ec;
  --static-brand-100: #fde3d1;
  --static-brand-300: #f7ac79;
  --static-brand-500: #f26f21; /* == cam bạn chỉ định, KHÔNG đổi */
  --static-brand-600: #d95e14; /* hover */
  --static-brand-700: #b44c10; /* active */

  --static-error-500: #e5484d;
  --static-success-500: #30a46c;

  /* alias — ngữ nghĩa, MỌI component chỉ dùng tầng này */
  --alias-bg-base: var(--static-neutral-0);       /* nền trang = trắng */
  --alias-bg-subtle: var(--static-neutral-50);     /* panel/input/dialog */
  --alias-border-default: var(--static-neutral-200);
  --alias-label-primary: var(--static-neutral-900); /* chữ chính = đen */
  --alias-label-secondary: var(--static-neutral-500);
  --alias-accent: var(--static-brand-500);
  --alias-accent-hover: var(--static-brand-600);
  --alias-accent-active: var(--static-brand-700);
  --alias-accent-subtle-bg: var(--static-brand-100);
  --alias-state-error: var(--static-error-500);
  --alias-state-success: var(--static-success-500);

  /* specific — theo đúng chỗ dùng thật, KHÔNG thêm token chưa có consumer */
  --specific-bubble-user-bg: var(--alias-accent-subtle-bg);
  --specific-bubble-user-text: var(--alias-label-primary);
}
```

**Quyết định thiết kế cần ghi rõ (không phải bikeshed im lặng)**: user bubble
dùng **tint cam nhạt** (`brand-100`) + chữ đen, KHÔNG dùng cam đặc
(`brand-500`) làm nền — cam đặc dành cho nút hành động chính (send, accent).
Lý do: chữ đen trên nền cam đặc #F26F21 có contrast ratio biên (~4.1:1, sát
ngưỡng AA 4.5:1 cho text thường), còn tint nhạt + chữ đen an toàn tuyệt đối
và vẫn rõ "có thương hiệu cam" qua viền/tint — đổi lại nếu bạn muốn bubble
cam đặc, chỉ cần sửa 2 dòng `--specific-bubble-user-*` ở trên.

**Deliverable 10.1: ĐÃ XONG** — `packages/ui-theme/{package.json,src/tokens.css,tests/tokens.test.ts}`,
7 test pass thật (parse trực tiếp file CSS bằng regex, không tin bằng mắt):
đủ token 3 tầng, không còn dấu vết `--dsw-*` (namespace gốc của dsh), mọi
token alias/specific tham chiếu `var(--...)` trỏ đúng tới token có thật
(không dangling reference), alias/specific KHÔNG hardcode màu thô (luôn qua
var(), đúng nguyên tắc "không nhảy tầng"), giá trị đúng bảng màu user yêu
cầu (`#f26f21`/`#ffffff`/`#222222`), bubble user dùng đúng tint nhạt (không
phải cam đặc, đúng quyết định thiết kế đã ghi). `npm install` tạo đúng
symlink `node_modules/@agent-core/ui-theme`. `npm test` 75/75 pass (từ 68),
`npm run typecheck` sạch.

### 10.2 Áp token vào `apps/web` — thay toàn bộ theme tối cũ — ĐÃ BUILD

`apps/web/src/style.css` import `@agent-core/ui-theme/src/tokens.css` qua
`@import` CSS (verify thực nghiệm: Vite resolve bare specifier `@import`
qua workspace symlink đúng ngay, giá trị `#f26f21` có mặt trong CSS build
ra — không suy đoán). Mọi biến cũ (`--bg`/`--panel`/`--text`/`--accent`...)
đổi hết sang `var(--alias-*)`/`var(--specific-*)`. `color-scheme: dark` →
`light`. Sweep shimmer của `ToolRow` (Phase 9.4) đổi tint từ xanh
(`rgba(79,124,255,...)`) sang cam (`rgba(242,111,33,...)`) — chi tiết dễ bỏ
sót vì hardcode màu ngay trong animation, không qua token.

**Deliverable 10.2: ĐÃ XONG** — `npm run build:web` sạch, CSS output chứa
đúng `#f26f21`/`color-scheme:light`, không còn biến tên cũ nào sót.

### 10.3 Port `Button` (ui-primitives) — CSS Modules, dạng viên thuốc — ĐÃ BUILD

`apps/web/src/{Button.tsx,Button.module.css,css-modules.d.ts}` —
`border-radius: 18px`, `height: 36px`, biến thể `size: 'md' | 'sm'`,
`variant: 'primary' | 'default'`. Thay toàn bộ `<button>` thô trong
`App.tsx` (new-chat, settings, compose-send, settings-cancel/save) bằng
component này — lần đầu tiên repo dùng CSS Modules (Vite hỗ trợ sẵn, không
cần cài thêm dependency). `css-modules.d.ts` (ambient type cho
`*.module.css`) bắt buộc phải thêm — TS không tự hiểu `import styles from
'./X.module.css'` nếu thiếu, cùng tên file dsh thật dùng.

Rule `<button>` global cũ (`button { ... }`) GIỮ NGUYÊN, không xoá — vẫn là
fallback thật cho `WebSearchCard` (`packages/ui-tool-web-search`, Phase 9.5)
vì package đó KHÔNG thể phụ thuộc ngược vào `apps/web` (đảo hướng phụ thuộc)
để dùng `<Button>`.

**Deliverable 10.3: ĐÃ XONG** — verify qua `grep` CSS build ra: có class
hash `_button_*` (xác nhận CSS Modules thật xử lý, không phải global CSS
thường) + `border-radius:18px`. `npm run typecheck`/`build:web` sạch.

### 10.4 Port hình học bubble tin nhắn (`MessageItem`) + assistant full-width markdown — ĐÃ BUILD

- User bubble: `.msg-user` đổi đúng hình học dsh (`border-radius: 22px;
  padding: 10px 16px; max-width: min(525px, 82%)`), nền/chữ dùng token
  `--specific-bubble-user-*` (10.1).
- **Assistant KHÔNG còn là bubble** — `apps/web/src/AssistantMarkdown.tsx`
  (dùng `react-markdown@^9`, không tự viết parser — coding rule A6 áp dụng
  cả hướng "đừng tự xây cái đã có thư viện tốt"), chảy full-width
  (`.msg-assistant { max-width: 100% }`), đúng pattern `AssistantMarkdown`
  thật của dsh.
- **Markdown thật** — xác nhận đúng như dự đoán trong plan: model trả lời
  THẬT có markdown thật (log chat Phase 8/9: `"**Mức giá bán ra:**"`), UI
  trước đó hiện nguyên `**`/`*` thô — bug có sẵn từ Phase 7, lộ ra khi đối
  chiếu đúng pattern dsh, không phải suy đoán.

**Deliverable 10.4: ĐÃ XONG** — `apps/web/tests/AssistantMarkdown.test.tsx`,
4 test render THẬT (không chỉ tin thư viện hoạt động vì cài đặt/build
xanh): `**in đậm**` → `<strong>` thật (không còn dấu `**`); danh sách
markdown → `<ul>`/`<li>` thật (đếm đúng số item); code block → `<pre><code>`
giữ nguyên nội dung; text thường không có markdown vẫn render đúng nguyên
văn. `ToolRow`/`GenericToolCard`/`WebSearchCard` không đổi logic, chỉ đổi
token màu tham chiếu (đã verify qua 10.2 không phá test cũ nào của chúng).
`npm test` 79/79 pass (từ 75).

### 10.5 Chủ động KHÔNG port — GIỮ NGUYÊN QUYẾT ĐỊNH

- **`AppFrame` (layout 3 cột)** — agent-core là chat đơn cột, không có
  sidebar/details panel, port vào sẽ là hạ tầng thừa không consumer nào cần
  (coding rule A6).
- **`ui-brand-official`** — tài sản thương hiệu riêng của DeepSeek, không
  liên quan "design system" tái sử dụng được, không phù hợp để clone dù
  chỉ tham khảo cấu trúc.
- **Toggle dark/light runtime** — agent-core chỉ có 1 theme (sáng, cam/
  trắng/đen) theo yêu cầu, chưa có nhu cầu thật cho theme thứ 2.

**Deliverable Phase 10 (tổng): ĐÃ XONG** — `apps/web` build/test/typecheck
sạch với theme mới hoàn toàn (không còn dấu vết theme tối cũ, `git grep` —
thật ra không có git, kiểm bằng đọc lại toàn bộ `style.css` — xác nhận
không còn biến `--bg`/`--panel`/`--text`/`--accent`/`--user-bubble`/
`--assistant-bubble`/`--step-bubble` tên cũ nào), verify qua
`docker compose up --build` + curl thật (title trang, CSS chứa `#f26f21` +
`border-radius:22px`, container `healthy`). 79/79 test pass, 20 file test
(từ 68/18 ở Phase 9). **CHƯA verify được bằng mắt** — môi trường build
không có trình duyệt, cần user tự mở `http://localhost:8790` xác nhận màu
sắc/bố cục đúng ý trước khi coi Phase 10 là hoàn thành đầy đủ.

---

## Phase 11 — Audit fix: đối chiếu `docs/agent-core-master-summary.md` — ĐÃ BUILD

`docs/agent-core-master-summary.md` là tài liệu tầm nhìn/kế hoạch từ giai
đoạn đầu — phần lớn nội dung (Skills, tool Python/MCP, `profiles/`, frontend
Next.js, Docker backend/frontend tách riêng, OpenTelemetry đầy đủ,
`/admin/swap-bundle`) đã CHỦ ĐỘNG không build (ghi rõ lý do ở từng phase
tương ứng, không phải bỏ sót). Đối chiếu lại mục 7 và 10 của doc đó với code
thật, xác nhận đúng **2 gap thật** đáng sửa ngay (rẻ, liên quan trực tiếp
core, không phải side-quest):

1. **`bundles/tools/tool-web-search`: `fetch()` gọi DuckDuckGo không có
   timeout** — nếu bên ngoài treo, cả turn treo vô thời hạn theo. Thêm
   `AbortController` + `timeoutMs` (default 10s, config qua
   `WEB_SEARCH_TIMEOUT_MS`), cùng pattern đã có ở `llm-qwen` (Phase 8.3).
   3 test mới (`tests/tool-web-search-timeout.test.ts`, `global.fetch` giả —
   không gọi mạng thật): treo quá timeout → throw lỗi rõ ràng; response về
   trước timeout → hoạt động bình thường; không set config → dùng default.
2. **`packages/ui-react/src/RenderSlot.tsx` không có Error Boundary** — nếu
   component của 1 UI-plugin (hoặc chính `fallback`) throw lúc render, lỗi
   lan ra React root, **crash trắng toàn bộ trang**, không chỉ 1 tool-row.
   Thêm `SlotErrorBoundary` (class component — bắt buộc, không có hook
   tương đương `componentDidCatch`), `RenderSlot` tự bọc CẢ Component thật
   lẫn `fallback` bên trong — 1 trong 2 throw thì hiện `errorFallback` tĩnh
   (không gọi lại code người khác viết, tránh throw lặp). 5 test mới
   (`packages/ui-react/tests/SlotErrorBoundary.test.tsx`): children render
   bình thường không hiện fallback; children throw → hiện fallback, không
   crash; qua `RenderSlot` với UI-plugin throw → hiện `errorFallback`, phân
   biệt rõ với case "không có entry"; `fallback` chính nó throw → vẫn bị
   bắt; không truyền `errorFallback` → dùng default tĩnh.

2 rule mới rút ra (coding rule A17 cho timeout, mở rộng A15 cho Error
Boundary — xem `docs/agent-core-cordis-coding-rules.md`).

**Deliverable Phase 11: ĐÃ XONG** — `npm test` 87/87 pass (từ 79, +8 test),
`npm run typecheck` sạch, verify end-to-end thật qua WS trong Docker sau
rebuild (hỏi giá vàng → `web_search` vẫn trả 5 kết quả thật đúng trong
default timeout 10s, không bị fix làm gãy hành vi thật).

---

## Phase 12 — `packages/ui-primitives`: bộ component design-system dùng chung — ĐÃ BUILD

Sau khi kiến trúc + màu sắc (Phase 9-10) đã ổn, mở rộng THÊM design-system
dùng chung — nhưng **chỉ phần thật sự áp dụng được cho 1 chat UI đơn cột**,
không cố clone toàn bộ 30 package `ui-*` của dsh (phần lớn gắn tính năng
riêng của họ — job management, sidebar nhiều panel, plan editor... — agent-
core không có tính năng tương ứng, clone UI cho tính năng không tồn tại
không có chỗ nào để gắn vào). Phạm vi chốt cùng user trước khi build: 5
component mới (Modal, Tooltip, Toast, Pill, StateDot) + dọn 1 wrinkle kiến
trúc có sẵn từ Phase 10.3.

**`packages/ui-primitives`** (package mới) — mọi component CSS Modules, chỉ
tham chiếu token `packages/ui-theme` (Phase 10.1), không hardcode màu:

- **`Button`** — CHUYỂN từ `apps/web/src/Button.tsx` (Phase 10.3) sang đây,
  không đổi logic/API. Lý do dọn: `packages/ui-tool-web-search`
  (`WebSearchCard`, Phase 9.5) trước đó phải tự dùng `<button>` thô vì
  KHÔNG THỂ phụ thuộc ngược vào `apps/web` (đảo hướng phụ thuộc: app phụ
  thuộc UI-plugin, UI-plugin không được phụ thuộc ngược lại app) — giờ cả
  `apps/web` lẫn `packages/ui-tool-web-search` cùng phụ thuộc
  `ui-primitives` (hướng phụ thuộc đúng), `WebSearchCard` đổi 2 nút thao tác
  ("Mở tất cả", toggle snippet) sang dùng `<Button size="sm">` thật.
- **`Modal`** — đóng gói pattern `<dialog>`/`showModal()`/`close()` thủ công
  (trước đây inline trong `App.tsx` qua `dialogRef` + `useEffect`) thành 1
  component tái dùng được (`open`/`onClose` prop), vẫn dùng `<dialog>` gốc
  (giữ accessibility có sẵn từ trình duyệt: Esc để đóng, focus trap,
  backdrop) — chỉ đóng gói phần imperative.
- **`Tooltip`** — CSS thuần (hover/focus-within), KHÔNG dùng thư viện
  positioning ngoài (floating-ui...) — đủ cho nhu cầu thật (label ngắn trên
  nút icon `⚙`), quá mức nếu cần auto-flip theo viewport (coding rule A6).
- **`Toast`/`useToasts`** — thông báo nổi tự biến mất sau N ms (default
  4s). Dùng cho lỗi HỆ THỐNG/kết nối (API key sai) — KHÔNG dùng cho lỗi
  tool throw giữa turn (vẫn giữ nguyên dạng bubble trong chat, vì đó là nội
  dung hội thoại thật, khác thông báo hệ thống thoáng qua).
- **`Pill`** — formalize `.status`/`.status-*` (CSS thô trước đây trong
  `apps/web/src/style.css`) thành component, `tone` biến thể theo trạng
  thái (neutral/success/error/accent).
- **`StateDot`** — chấm tròn báo trạng thái nhỏ, đi kèm `Pill` trong status
  header. `role="status"` + `aria-label` CHỈ khi có `label` — chấm không có
  label coi là thuần trang trí, không được đọc bởi screen reader gây nhiễu.

**Tích hợp vào `apps/web/src/App.tsx`**: header status đổi từ `<span
className="status...">` sang `<Pill><StateDot/>...</Pill>`; nút `⚙` bọc
trong `<Tooltip>`; `<dialog>` thủ công đổi thành `<Modal open={settingsOpen}
onClose={...}>`; lỗi "API key không hợp lệ" (WS đóng code 401) đổi từ bubble
chat vĩnh viễn sang `pushToast(..., 'error')` — dọn theo: xoá CSS chết
(`.status`/`.status-*`, `dialog`/`dialog::backdrop` global rule — đã chuyển
vào `Modal.module.css` scoped).

**Deliverable Phase 12: ĐÃ XONG** — `packages/ui-primitives/tests/primitives.test.tsx`,
12 test render THẬT: `Button` (variant/disabled), `Modal` (open/close phản
ứng đúng theo prop, kể cả đổi `true→false` giữa chừng), `Tooltip` (label
trong DOM đi kèm children), `Pill` (tone thêm đúng class, mặc định không
thêm class thừa), `StateDot` (role/aria-label chỉ xuất hiện khi có label),
`useToasts`/`ToastContainer` (push thêm toast, tự biến mất sau
`autoDismissMs` — dùng `vi.useFakeTimers()`, không đợi thời gian thật). Bắt
được 1 conflict thật khi tích hợp: `Tooltip` label "Cấu hình kết nối" trùng
chữ với heading dialog `<h2>` — smoke test cũ (`App.smoke.test.tsx`) dùng
`getByText` (không đặc hiệu) giờ match 2 chỗ, throw "multiple elements
found". Sửa bằng `getByRole('heading', ...)` — đúng ý định thật của
assertion ("dialog đã mở"), không phải né tránh bằng cách đổi chữ cho khác
đi. `npm test` 99/99 pass (từ 87, +12 test), verify qua `docker compose up
--build` + curl thật.

---

## Phase 13 — Layout sidebar + lịch sử session (2 gap backend + Sidebar) — ĐÃ BUILD

User muốn layout web chat có cấu phần sidebar như dsh (`AppFrame`). Khác Phase
10.5 (lúc đó quyết định KHÔNG port vì "chưa có tính năng nào cần sidebar") —
lần này quyết định thay đổi vì sidebar giờ có nội dung THẬT để hiện: lịch sử
session. Trước khi build UI, kiểm tra backend có hỗ trợ list/resume session
không — phát hiện **2 gap thật**, sửa cả 2 trước khi sidebar có nghĩa (không
làm sidebar rỗng chỉ để giống layout):

1. **Không có `GET /sessions` list endpoint** — quyết định KHÔNG thêm (không
   phải bỏ sót): `session-registry` không có khái niệm "chủ sở hữu" 1
   session, API key hiện là 1 key dùng chung nội bộ không tách theo user —
   thêm endpoint liệt kê TẤT CẢ session sẽ để bất kỳ ai cầm key thấy được
   session của người khác, rò rỉ chéo không cần thiết. Thay bằng theo dõi
   lịch sử Ở PHÍA CLIENT (`localStorage`, `apps/web/src/sessionHistory.ts`)
   — mỗi trình duyệt chỉ thấy đúng session nó tạo, tránh hẳn vấn đề.
2. **Tin nhắn USER không hề được lưu storage** — chỉ `model_message`/
   `tool_result`/`critic_message` được ghi (`storage.appendEvent`), KHÔNG
   driver nào ghi lại câu hỏi gốc của user. `GET /sessions/:id/events` vì
   vậy chỉ thấy câu trả lời, mất hết câu hỏi — resume session qua REST sẽ
   dựng lại lịch sử SAI, thiếu nửa cuộc hội thoại. Sửa bằng cách thêm
   `await this.ctx.storage.appendEvent(session.id, { type: 'user_message',
   content: userMessage })` NGAY ĐẦU `AgentRunner.runTurn()`
   (`bundles/providers/agent-runner`) — entrypoint ổn định DUY NHẤT cho mọi
   driver (coding rule B4), không lặp lại logic này trong từng loop driver
   riêng. **Kèm theo đó**: `toolUi` (Phase 8.5) trước đây CHỈ phát qua
   `agent/step` live, không lưu storage — resume 1 tool-call cũ sẽ mất icon/
   label/citations. Thêm `toolUi: tool?.ui` vào cả 2 lời gọi
   `storage.appendEvent` trong `loop-default`/`loop-planner-critic` (cùng
   giá trị đã tính cho `agent/step` ngay cạnh đó).
   **Cả 2 thay đổi này làm 4 test cũ (`tests/agent-loop.test.ts`,
   `tests/api-rest.test.ts`, `tests/chaos-hot-swap.test.ts`,
   `tests/sessions-and-streaming.test.ts`) fail** — đúng như kỳ vọng (hành
   vi cố ý thay đổi, không phải regression) — cập nhật lại assertion đúng
   sequence event mới, không né bằng cách giữ hành vi cũ.

**`apps/web/src/Sidebar.tsx`** — layout 2 cột (sidebar + main), đơn giản hoá
CÓ CHỦ ĐÍCH so với `AppFrame` thật của dsh (3 cột resizable sidebar/center/
details): 2 cột CỐ ĐỊNH, không có "details panel" (không có tính năng thứ 3
để hiện ở đó — coding rule A6). Sidebar có nút "+ Chat mới" (di chuyển từ
header cũ, primary action giờ ở đây) + danh sách session (title = câu hỏi
đầu tiên, click để resume).

**Cơ chế resume session** — WS protocol KHÔNG có message "resume" riêng:
`send_message` chấp nhận BẤT KỲ `sessionId` hợp lệ nào (miễn còn sống trong
TTL trượt của session-registry, Phase 8.1), không quan tâm nó được tạo qua
kết nối WS nào. Nên resume = (1) `GET /sessions/:id/events` (REST) tải lịch
sử thật, (2) dựng lại `ChatItem[]` qua `reconstructItems()` (khác
`applyStep()` — xử lý 1 MẢNG event lưu sẵn có `user_message`, không có
`final` riêng vì `model_message` không kèm `toolCall` CHÍNH LÀ câu trả lời
cuối), (3) mở WS mới nhưng BỎ QUA `create_session` (session đã tồn tại
server-side). Session hết hạn/không tồn tại (404) → toast lỗi, không crash.

**Deliverable Phase 13: ĐÃ XONG** — 8 test mới (`apps/web/tests/sessionHistory.test.ts`,
localStorage CRUD thật: thêm/không trùng lặp/cập nhật đúng session không
đụng session khác/cắt title dài/xoá/persist qua "reload"/JSON hỏng không
throw), verify end-to-end THẬT qua WS + REST trong Docker sau rebuild: gửi
"chào bạn, 1+1 bằng mấy" → `GET /sessions/:id/events` trả đúng
`['user_message', 'model_message']`, `user_message.content` khớp chính xác
tin nhắn đã gửi. `npm test` 107/107 pass (từ 99, +8 test trực tiếp +
cập nhật 4 test cũ), `npm run typecheck` sạch, `docker compose up --build`
thành công, container healthy.

---

## Phase 14 — Sidebar thu gọn được + list lịch sử mượt hơn + trigger "Cấu hình" cuối sidebar — ĐÃ BUILD

User phản hồi UI Phase 13 "chưa đẹp/chưa đúng cấu trúc dsh": muốn sidebar
đóng/mở được, list lịch sử mượt hơn, và 1 hàng dạng "profile" cuối sidebar
mở Settings — chủ động cho phép đọc source thật của dsh để lấy đúng pattern
("cần thì fork lấy UI đó luôn"). Máy này có sẵn checkout first-party
`deepseek-harness/packages/client/{ui-sidebar,ui-layout,ui-settings-general}`
(không phải bản vendor rút gọn) — dùng 1 fork đọc trực tiếp `SidebarRoot.tsx`/
`.module.css` + `chrome.tsx` (hàng trigger settings) để rút ra ĐÚNG pattern
thật bằng lời (không suy đoán), rồi viết lại 100% code MỚI theo token/
component của agent-core — **tuyệt đối không copy nguyên JSX/CSS gốc vào
repo này** (ràng buộc bản quyền xuyên suốt dự án, giữ nguyên kỷ luật đã áp
dụng từ Phase 9).

**Phát hiện thật từ source (mô tả lại bằng lời, không trích nguyên văn)**:
sidebar thu gọn của dsh KHÔNG ẩn hẳn — co lại thành 1 "rail" icon-only
(~56px), các control tròn 28-36px với hover là 1 lớp nền phủ, và hàng cuối
sidebar KHÔNG phải avatar/tên người dùng mà là 1 nút "Settings" (icon bánh
răng + nhãn chữ) mở panel cấu hình — đúng ý "label profile ấn vào có
settings" user mô tả, chỉ khác tên gọi (dsh không có khái niệm tài khoản
người dùng ở tầng này). Port lại đúng 3 ý đó, đơn giản hoá có chủ đích
(coding rule A6): bỏ cơ chế 2-pha slide/settle + "quiet scrollbar theo con
trỏ" của bản gốc — 1 CSS `transition: width` là đủ cho layout 2 cột tĩnh
hiện tại.

**Thay đổi**:
- `apps/web/src/sidebarState.ts` (MỚI) — `loadSidebarCollapsed()`/
  `saveSidebarCollapsed()`, cùng quy ước localStorage với `settings.ts`/
  `sessionHistory.ts` (đúng key riêng `agent-core-ui-sidebar-collapsed`,
  không throw khi đọc hỏng).
- `apps/web/src/Sidebar.tsx` — viết lại: hàng toggle trên cùng (nút tròn
  «/»), "+ Chat mới" thu về nút tròn 36px icon-only khi collapsed, list
  lịch sử ẨN khi collapsed (không có cách hiện text tuỳ ý dưới dạng icon có
  nghĩa), hàng "Cấu hình" cố định cuối sidebar (`margin-top: auto`) — luôn
  hiện dù collapsed hay không, mở đúng Settings `Modal` đã có sẵn.
- `apps/web/src/App.tsx` — **gỡ hẳn** nút bánh răng + `Tooltip` trong
  header (quyết định thiết kế: không giữ 2 lối vào cùng 1 modal), thay bằng
  prop `onOpenSettings` truyền xuống `Sidebar`.
- `apps/web/src/style.css` — polish `.sidebar-session-item` (border-radius
  8→10px, thêm `transition` mượt cho hover/active), thêm toàn bộ rule mới
  cho rail collapsed + hàng "Cấu hình" — tái dùng ĐÚNG cặp token
  `--alias-bg-subtle`/`--alias-bg-base` đã có cho hover thay vì thêm token
  màu song song mới.
- `apps/web/tests/sidebarState.test.ts` (MỚI) — 3 test localStorage CRUD
  (mặc định false, lưu true/false, đọc lại đúng).

**Deliverable Phase 14: ĐÃ XONG** — `npm test` 110/110 pass (từ 107, +3
test mới), `npm run typecheck` sạch, `docker compose up --build` thành
công, container healthy; verify THẬT bằng `curl` CSS bundle đã build
(`assets/index-*.css`) chứa đúng `sidebar-collapsed`/`sidebar-icon-btn`/
`sidebar-settings-trigger` — xác nhận CSS mới thật sự có trong image, không
chỉ "code trông đúng". Xác nhận bằng mắt qua trình duyệt thật vẫn CHƯA có
(môi trường build không có trình duyệt) — cần user tự mở
`http://localhost:8790` sau khi đọc phần này.

---

## Phase 15 — `ctx.skills` (skill-plugin) + fix 2 gap production-readiness ở `ctx.storage` — ĐÃ BUILD

User hỏi audit: "skill plugin" và "memory" đâu, `ctx.storage` đã production-
ready chưa. Kiểm tra thật (grep, đọc code) thay vì đoán, trả lời từng phần
trước khi build:

- **"Skill"**: chưa từng tồn tại — không phải bị bỏ sót, plan gốc Phase 1
  chỉ liệt kê llm/storage/memory/tools/permission/sandbox/subagents, không
  có "skill". Gần nhất là `ctx.tools` (hàm model tự gọi) và `ctx.subagents`
  (uỷ thác 1 task tách biệt) — cả 2 khác bản chất "skill" (gói hướng dẫn
  TĨNH, không gọi được, nạp có điều kiện vào context).
- **Memory**: `seams/memory.ts` có interface (`remember`/`recall`) từ
  Phase 1 nhưng CHƯA từng có provider — gọi `ctx.memory` sẽ lỗi vì service
  chưa đăng ký. Đã ghi rõ trong README "Ngoài phạm vi" từ đầu, vẫn CHƯA
  build ở phase này (không phải yêu cầu của user lúc này — user hỏi audit,
  không yêu cầu build memory-vector).
- **Storage**: phần lớn production-ready (SQLite thật qua `better-sqlite3`,
  lưu vào Docker named volume — sống sót qua recreate container, không phải
  `:memory:`; retention/TTL tuỳ chọn từ Phase 8.4) nhưng phát hiện 2 gap
  thật khi đọc code — **ĐÃ SỬA cả 2** trong `bundles/providers/state-sqlite`:
  (1) không có index trên cột `session_id` — `readEvents()` full table scan,
  thêm `CREATE INDEX IF NOT EXISTS idx_events_session_id`; (2) chưa bật WAL
  — mặc định rollback-journal khoá cả DB lúc ghi, thêm
  `db.pragma('journal_mode = WAL')` (bỏ qua cho `:memory:` — không có file
  để ghi `-wal`/`-shm` cạnh nó).

**`seams/skill.ts` (MỚI)** — `SkillDefinition { name, description,
instructions, triggers }`, `SkillRegistryService.register/get/has/list/
match()`. `match(userMessage)` so khớp substring không phân biệt hoa/thường
giữa `triggers` và tin nhắn user — KHÔNG dùng embedding/semantic search (hạ
tầng đó chưa có, `seams/memory.ts` vẫn chưa build), đủ dùng ở quy mô hiện
tại. **`bundles/providers/skill-registry`** — copy đúng pattern effect-
scoping của `tool-registry`/`subagent-manager` (coding rule A12, xem comment
gốc ở đó). **`bundles/skills/skill-support-tone`** — ví dụ #1: kích hoạt khi
tin nhắn có dấu hiệu khiếu nại/sự cố (`'khiếu nại'`, `'sự cố'`, `'lỗi mạng'`,
...), chèn hướng dẫn giọng văn hỗ trợ (xác nhận vấn đề → hỏi thông tin thiếu
→ đề xuất bước tiếp theo).

**Nối vào loop thật** (không chỉ đăng ký rồi bỏ đó — vi phạm nguyên tắc
"không nửa vời"): `Session.buildPrompt()` (`seams/loop.ts`) nhận thêm tham
số tuỳ chọn `extraSystemNotes: string[]`, chèn làm message role `'system'`
riêng ngay sau system prompt gốc — KHÔNG ghi vào `this.history` (skill được
match lại mỗi lượt dựa trên tin nhắn hiện tại, ghi cố định vào history sẽ
lặp lại nội dung này ở các lượt sau dù không còn liên quan). Vẫn đúng coding
rule B6 (buildPrompt là nơi DUY NHẤT ráp prompt) — cả `loop-default` và
`loop-planner-critic` chỉ gọi `runCtx.skills.match(userMessage)` rồi truyền
kết quả vào `buildPrompt()`, không tự ráp mảng message rời rạc. `llm-qwen`
map message 1:1 (`messages.map(mapMessage)`, verify bằng đọc code) — nhiều
message role `'system'` trong 1 request đi thẳng qua API thật, không bị lọc
bớt.

**Gap thật phát hiện khi nối dây**: `bundles/providers/agent-runner` gọi
`runCtx.skills` bên trong driver (qua `this.ctx` truyền làm `runCtx`) —
phải thêm `'skills'` vào `inject` của chính `agent-runner` (cùng lý do
`'tools'` đã có sẵn trong `inject` dù `agent-runner` không tự gọi
`ctx.tools` — inject phải liệt kê MỌI seam mà runTurn của bất kỳ driver nào
cần qua `runCtx`, không chỉ seam bản thân `apply()` dùng trực tiếp). Kéo
theo: **6 test file** đã mount `agentRunner` phải mount thêm `skillRegistry`
(cùng pattern đã mount `toolRegistry` sẵn) — không thì fiber `agent-runner`
suspend vì thiếu dependency, `root.agent` sẽ `undefined`.

**Deliverable Phase 15: ĐÃ XONG** — `tests/skill-registry.test.ts` (MỚI, 6
test: register/get/has/list, duplicate-name throw, match case-insensitive,
skill không trigger không bao giờ tự match, spatial composability skill ↔
skill-registry — đã verify THỰC NGHIỆM bằng script độc lập rằng
`root.skills` trả về `undefined` sau khi dispose fiber cung cấp nó, không
đoán) + 1 test mới trong `tests/agent-loop.test.ts` (capture đúng mảng
message gửi LLM, xác nhận instructions CÓ mặt khi trigger khớp, KHÔNG có mặt
khi không khớp, và KHÔNG bị ghi vào `session.history`). `npm test` 117/117
pass (từ 110, +7 test), `npm run typecheck` sạch. Verify THẬT qua WS + LLM
thật trong Docker sau rebuild: gửi "Tôi muốn khiếu nại vì sự cố mạng không
dùng được" → câu trả lời thật của model đi đúng cấu trúc skill yêu cầu (xác
nhận đã hiểu sự cố → hỏi mã khách hàng/thời điểm/loại kết nối → đề xuất bước
tiếp theo) — bằng chứng skill có tác dụng thật lên hành vi model, không chỉ
đăng ký rồi không ai dùng. `GET /sessions/:id/events` xác nhận
`user_message` vẫn được lưu đúng nội dung gốc.

---

## Phase 16 — Redesign UI: token scale đầy đủ + gộp về 1 hệ CSS Modules — ĐÃ BUILD

User phản hồi UI "chưa clean, không giống 1 sản phẩm hoàn thiện" — yêu cầu
lên plan như UI/UX designer rồi code như FE developer, lấy cảm hứng cấu
trúc/pattern từ 1 sản phẩm chat tham khảo (KHÔNG lấy màu/brand — agent-core
giữ nguyên cam/trắng/đen của `packages/ui-theme`, KHÔNG copy code verbatim —
chỉ đọc source thật để rút ra fact cấu trúc, viết lại 100% code mới).

**Audit trước khi sửa** tìm đúng root cause: `packages/ui-theme/src/tokens.css`
trước đây CHỈ có token màu (3 tầng) — không có spacing/radius/typography/
shadow/motion scale nào, mọi giá trị px trong app là literal rải rác không
hệ thống. Thêm 2 vấn đề thật: `packages/ui-primitives` dùng CSS Modules
đúng nhưng `apps/web/src/style.css` + `packages/ui-tool-web-search/src/
WebSearchCard.css` vẫn là global class, THẬT SỰ ĐỤNG NHAU tên class
(`tool-source*`) giữa `GenericToolCard` và `WebSearchCard`; và zero
`:focus-visible` ring ở bất kỳ đâu trong codebase (gap a11y thật).

**Token mới** (`packages/ui-theme/src/tokens.css`, đúng nguyên tắc 3 tầng
static→alias→specific có sẵn — `tokens.test.ts` validate tổng quát nên tự
động phủ token mới không cần sửa test): spacing (`--alias-space-xs..2xl`,
4/8/12/16/20/24px), radius (`--alias-radius-control/panel/capsule/pill`),
typography (`--alias-font-size-caption..heading-lg`, weight, line-height),
shadow (`--alias-shadow-raised/floating/overlay`), motion
(`--alias-motion-fast/base/slow` + 1 easing curve dùng chung). Cố tình
KHÔNG token hoá: kích thước layout đơn lẻ không thuộc nhịp lặp lại (sidebar
260px/56px, `#main` max-width 860px), 2 animation lặp đã tinh chỉnh sẵn
(`tool-row-sweep`, `state-dot-pulse` — khác bản chất so với transition 1 lần).

**Gộp về 1 hệ CSS Modules**: toàn bộ `apps/web/src/style.css` (607 dòng
global) migrate theo từng component — `Sidebar.module.css`, `ToolRow.module.css`,
`GenericToolCard.module.css`, `AssistantMarkdown.module.css` (+ thêm rule
heading h1-h4 trước đây chưa từng có), `App.module.css`. Tách mới 3
component từ `App.tsx`: `MessageBubble.tsx` (bubble + hover-reveal
timestamp/copy — timestamp CHỈ có ở session live, session resume qua
`GET /sessions/:id/events` không có data timestamp nên để `undefined`, xác
nhận qua đọc code thật, không suy đoán), `Composer.tsx` (sửa gap chức năng
thật: `<input>` 1 dòng → `<textarea>` tự giãn cao, Enter gửi/Shift+Enter
xuống dòng — trước đây không gõ được nhiều dòng), `EmptyState.tsx` (trước
đây không có trạng thái rỗng). Tạo mới `packages/ui-primitives/src/SourceList.tsx`
dùng chung cho `GenericToolCard` VÀ `WebSearchCard` — xoá tận gốc phần code
trùng lặp gây đụng class name, không chỉ scope CSS lại.

**Redesign cụ thể**: sidebar — hover/active trước đây 2 cơ chế khác nhau
(active có thêm border, hover chỉ đổi tint), giờ hội tụ về 1 cơ chế (chỉ
tint); collapse trước đây unmount lịch sử đột ngột dưới 1 width transition
(đọc như squish), giờ always-render + crossfade opacity riêng. `.msg-error`
sửa từ hex cứng `#fdeeee` sang token; `.msg-step` bỏ dashed-border+monospace
(đọc như debug output — nội dung là câu tự nhiên, không phải code). Composer
đổi từ 2 phần tử viền riêng biệt sang 1 "capsule" card liền khối
(`--alias-shadow-raised`), sửa luôn 1 gap a11y thật: `outline:none` cũ trên
input tắt hẳn focus ring — giờ tách `:focus` (border-color) và
`:focus-visible` (ring rõ, chỉ hiện khi điều hướng bàn phím). Chỉ báo "đang
trả lời" thêm mới — Ở CẤP LƯỢT (không phải gõ từng ký tự): WS protocol chỉ
có `step` nguyên khối, không có token-delta (xác nhận qua đọc `seams/loop.ts`
thật, không giả định).

**Gián đoạn giữa chừng do hết usage limit** (agent chạy nền bị dừng đột
ngột) — resume đúng chỗ dở: kiểm tra `git status`/`npm run typecheck`/
`npm test` trước khi tiếp tục thay vì đoán đã làm tới đâu, phát hiện 9/12
bước đã xong sạch (121/121 test), chỉ còn nối `App.module.css` vào `App.tsx`
+ thêm chỉ báo streaming + rút gọn `style.css`. Bắt được 1 lỗi thật lúc nối
dây tiếp: bản nháp cũ định thêm `composerText.trim().length > 0` vào
`composerEnabled` — sẽ disable luôn cả `<textarea>` lúc rỗng (không gõ được
ký tự đầu tiên), trong khi `Composer.tsx` đã tự tách đúng `canSend` riêng
cho nút Gửi — sửa lại, không áp dụng thay đổi sai đó.

**Deliverable Phase 16: ĐÃ XONG** — `npm test` 121/121 pass (từ 117, +4:
`SourceList` thêm vào `primitives.test.tsx`, `AssistantMarkdown.test.tsx`
sửa lại query sang CSS Modules), `npm run typecheck` sạch, `docker compose
up --build` thành công, container healthy, verify THẬT qua `curl` bundle
CSS build ra chứa đúng `alias-radius-capsule`/`alias-motion-fast`/
`focus-visible`/`prefers-reduced-motion`/`alias-shadow-raised`. Xác nhận
bằng mắt qua trình duyệt thật (đặc biệt hành vi `:focus-visible` bàn phím
vs chuột, `prefers-reduced-motion`, auto-grow composer) vẫn CHƯA có — môi
trường build không có trình duyệt, cần tự mở `http://localhost:8790` để
chắc trước khi coi là xong hoàn toàn.

---

## Phase 17 — Sidebar: logo + search cuộc trò chuyện — ĐÃ BUILD

Follow-up nhỏ sau Phase 16: user muốn hàng trên cùng sidebar có logo + 2 nút
icon (tìm kiếm, đóng/thu gọn sidebar). Đọc `Sidebar.tsx` thật trước khi làm:
nút thu gọn (`«`/`»`) đã có sẵn từ Phase 14 — chỉ có tìm kiếm là thật sự
mới.

**Logo**: badge chữ "A" nền cam (`--alias-accent`) + wordmark "agent-core",
đúng convention glyph đơn giản đã dùng khắp app (không thêm bộ icon SVG
riêng chỉ cho 1 chỗ). Ẩn hẳn lúc collapsed (rail chỉ còn 1 nút mở rộng,
giống cách `+ Chat mới`/hàng Cấu hình đã rút gọn icon-only).

**Search**: lọc client-side trên `sessions` prop đã có sẵn (không gọi API
mới, không đọc localStorage trực tiếp trong Sidebar — component thuần).
Click icon 🔍 mở 1 input pill (auto-focus), gõ lọc theo title (substring,
không phân biệt hoa/thường), Escape hoặc click icon lần nữa đóng lại + xoá
query. 0 kết quả khớp hiện thông báo RIÊNG ("Không tìm thấy cuộc trò chuyện
nào phù hợp") — khác thông báo "Chưa có cuộc trò chuyện nào" khi sessions
rỗng hoàn toàn, tránh nhầm 2 trường hợp. Thu gọn sidebar trong lúc đang tìm
kiếm tự đóng luôn ô search (tránh kẹt input ẩn phía sau khi mở rộng lại).

**Deliverable Phase 17: ĐÃ XONG** — `apps/web/tests/Sidebar.test.tsx` (MỚI,
component này trước đây chưa có test riêng): 6 test — logo hiện đúng, toggle
mở/đóng search, lọc đúng theo title, thông báo rỗng đúng loại, Escape đóng +
reset, click lại icon để đóng. `npm test` 127/127 pass (từ 121, +6), `npm run
typecheck` sạch, `docker compose up --build` healthy, verify thật qua curl
bundle CSS chứa đúng `logoMark`/`searchInput`/`topActions`.

---

## Phase 18 — Icon thật (`lucide-react`) thay glyph text — ĐÃ BUILD

User: icon UI đang dùng ký tự text (🔍/«/»/⚙/●/›/💬/chữ "Sao chép") — muốn
đổi sang 1 bộ icon thật, đặc biệt icon "open"/"close" sidebar thay mũi tên.

Thêm `lucide-react` (`apps/web/package.json`, `^1.33.0`) — SVG thuần, zero
dependency, đủ nhẹ để chấp nhận (bundle JS chỉ tăng ~2KB gzip nhờ tree-
shaking thật — verify bằng build thật, không giả định). **Quyết định phạm
vi quan trọng**: chỉ đổi icon CHROME phía client (Sidebar, ToolRow, Message
Bubble, EmptyState) — KHÔNG đổi `ToolUiHint.icon` (`seams/tools.ts`), vẫn
là string emoji do chính tool backend khai (`bundles/tools/*`), vì đó là
hợp đồng seam mở rộng được (tool nào cũng chỉ cần khai 1 emoji, không cần
import bộ icon client) — đổi seam này là quyết định kiến trúc khác, ngoài
phạm vi yêu cầu lần này.

Đổi cụ thể: `Sidebar.tsx` — 🔍/× (search toggle), `PanelLeftClose`/
`PanelLeftOpen` (đúng ngữ nghĩa đóng/mở sidebar user yêu cầu, không phải
mũi tên chung chung), `Settings` (thay ⚙). `ToolRow.tsx` — `ChevronRight`
(thay ›, giữ nguyên cơ chế xoay 90° lúc mở), `CircleAlert` (thay ● lúc lỗi);
nhân tiện dọn 1 dead code thật phát hiện lúc sửa: div gốc còn giữ class
`"msg "` mồ côi từ trước Phase 16 (rule `.msg` đã xoá khỏi `style.css`, `
.toolRow` tự đủ layout riêng — xoá phần thừa). `MessageBubble.tsx` — nút
copy đổi từ text "Sao chép" sang icon-only `Copy` (giữ `aria-label` cũ cho
a11y). `EmptyState.tsx` — `MessageSquare` thay 💬.

**Deliverable Phase 18: ĐÃ XONG** — `npm test` 127/127 pass (không đổi số
lượng — test cũ chỉ query theo `aria-label`/placeholder, không theo glyph
cụ thể, nên không cần sửa test nào), `npm run typecheck` sạch, `docker
compose up --build` healthy, verify thật qua curl JS bundle build ra chứa
đúng code `lucide-react` (`createLucideIcon`/`panel-left-close`).

---

## Phase 19 — Tooltip: luôn hiện dưới, nền xám, thoát clipping của ancestor `overflow: hidden` — ĐÃ BUILD

User: tooltip cần LUÔN hiện phía dưới, nền màu xám, và không được bị cắt
mất bởi `overflow: hidden` (đúng linh cảm 1 giới hạn CSS thật).

**Gap thật xác nhận bằng đọc code**: `Tooltip.tsx` cũ định vị bubble bằng
`position: absolute` LỒNG trong `.wrapper` — bất kỳ ancestor nào set
`overflow: hidden`/`auto` (vd. `#sidebar` cuộn lịch sử) sẽ CẮT bubble bất kể
z-index cao thế nào. Đây không phải bug code, là giới hạn CSS thật: z-index
không thoát được clipping context của ancestor.

**Sửa bằng `createPortal`** (`react-dom`, đã có sẵn — không thêm
dependency) — bubble render thẳng vào `document.body`, toạ độ tính bằng
`getBoundingClientRect()` của wrapper lúc hover/focus, `position: fixed`
thay vì `absolute`. Bubble vẫn LUÔN mount trong DOM (ẩn qua opacity/
visibility, KHÔNG phải conditional render) — giữ đúng hành vi cũ mà
`primitives.test.tsx` đã test từ trước (`role="tooltip"` tồn tại kể cả chưa
hover) — không cần sửa test nào.

Token mới: `--specific-tooltip-bg` (neutral-700 #444444, "xám đậm" — khác
hẳn `--alias-label-primary` gần đen #222 dùng trước đây) + `--specific-
tooltip-text` (trắng). Vị trí đổi từ `bottom: calc(100% + 6px)` (phía trên)
sang luôn `top: rect.bottom + 6px` (phía dưới) — không có logic auto-flip
theo viewport (chưa cần, coding rule A6). `z-index: 9999`.

**Deliverable Phase 19: ĐÃ XONG** — `npm test` 127/127 pass (không đổi số
lượng, test `Tooltip` cũ pass nguyên vẹn), `npm run typecheck` sạch, `docker
compose up --build` healthy, verify thật qua curl CSS bundle chứa đúng
`--specific-tooltip-bg`/`#444444`/`z-index:9999`.

---

## Phase 20 — Search chuyển sang modal giữa màn hình + debounce + skeleton — ĐÃ BUILD

Follow-up thứ 2 cho search (sau Phase 17): user muốn bấm icon search hiện
1 modal giữa màn hình (nền mờ blur), và khi gõ — chờ NGỪNG gõ (debounce)
mới hiện kết quả, trong lúc chờ hiện skeleton.

**Thay input inline trong sidebar bằng `SearchModal.tsx`** (mới,
`apps/web/src/`) — tái dùng `Modal` (`packages/ui-primitives`) sẵn có,
KHÔNG tạo component dialog riêng. `Sidebar.tsx` rút gọn lại đúng 1 việc: nút
mở modal (`searchOpen` state) — bỏ hẳn `searchQuery`/`filteredSessions` cũ,
danh sách lịch sử trong sidebar trở về hiện ĐỦ (không lọc, lọc là việc của
modal).

**Debounce + skeleton**: `query` (gõ tức thời) và `debouncedQuery` (chỉ cập
nhật sau 300ms KHÔNG gõ thêm) — `searching = query !== debouncedQuery` là
điều kiện hiện `Skeleton` (`packages/ui-primitives/src/Skeleton.tsx`, MỚI —
3 thanh xám shimmer, cùng kỹ thuật gradient-sweep đã dùng cho tool-row/
streaming row). Lọc vẫn client-side thuần trên `sessions` đã có sẵn qua
prop — KHÔNG có độ trễ mạng thật nào, debounce là quyết định UX có chủ đích
(tránh list nhấp nháy mỗi phím gõ), không phải giả lập latency giả.

**Blur backdrop**: thêm `backdrop-filter: blur(8px)` vào `Modal.module.css`
`::backdrop` — áp dụng cho MỌI modal (kể cả settings), không tách biến thể
riêng chỉ cho search, giữ nhất quán 1 hệ thị giác.

**Gap thật phát hiện lúc sửa test** (Sidebar giờ LUÔN render SearchModal ẩn
sẵn trong DOM, kể cả lúc đóng): 2 test cũ vỡ theo cách khác nhau, cả 2 đều
liên quan tới việc giờ có **2 `<dialog>`** cùng lúc trong cây (SearchModal +
Settings) — (1) `apps/web/tests/Sidebar.test.tsx` dùng `getByText` (KHÔNG
lọc theo trạng thái hidden) tìm thấy CÙNG session title ở cả list sidebar
thật lẫn nội dung ban đầu (chưa lọc) của SearchModal đang ẩn → "multiple
elements found" — sửa bằng `within(historyNav)` scope đúng vào nav lịch sử
của sidebar; (2) `App.smoke.test.tsx` dùng `document.querySelector('dialog')`
thô giờ vớ nhầm dialog SearchModal (luôn đứng trước trong DOM order) thay vì
dialog settings — xác nhận thực nghiệm rằng `getByRole` (khác `getByText`)
CÓ lọc theo accessibility (dialog đóng → nội dung bên trong "vô hình" với
`queryByRole`, do UA stylesheet ẩn `dialog:not([open])`) — sửa bằng
`getByRole('heading', ...)`/`queryByRole(...)` thay vì query tag thô, đúng
hành vi thật đã verify chứ không đoán.

**Deliverable Phase 20: ĐÃ XONG** — `apps/web/tests/SearchModal.test.tsx`
(MỚI, 5 test: hiện đủ session lúc chưa gõ không skeleton, gõ vào hiện
skeleton ngay lúc debounce đang chờ, sau debounce lọc đúng không phân biệt
hoa/thường, 0 kết quả hiện thông báo riêng, click kết quả gọi đúng
`onSelectSession`+`onClose` — dùng `vi.useFakeTimers()`/`advanceTimersByTime`
cùng pattern `useToasts` đã có), `packages/ui-primitives/tests/
primitives.test.tsx` +2 test Skeleton, `Sidebar.test.tsx` viết lại 3 test
(rút gọn từ 6, khớp scope mới), `App.smoke.test.tsx` sửa 1 assertion.
`npm test` 131/131 pass (từ 127, +4 net), `npm run typecheck` sạch, `docker
compose up --build` healthy, verify thật qua curl CSS bundle chứa đúng
`backdrop-filter`/`skeleton-sweep`.

---

## Phase 21 — SearchModal: ghim vị trí trên, nút X đóng, click-outside đóng — ĐÃ BUILD

Follow-up thứ 3 cho search (sau Phase 20): user báo modal đang canh giữa
màn hình nên lúc skeleton↔kết quả đổi chiều cao thì bị "nhảy" vị trí (do
`<dialog>` mặc định canh giữa bằng `margin: auto`, chiều cao đổi kéo theo vị
trí đổi theo); và chưa có cách đóng ngoài phím Esc.

**`Modal.tsx` (`packages/ui-primitives`) thêm 2 khả năng mới, dùng chung cho
MỌI modal** (không tách biến thể riêng cho search — cùng lý do nhất quán đã
áp dụng cho backdrop blur ở Phase 20):
1. `className?: string` — nơi gọi thêm được CSS riêng (gắn THÊM, không thay
   `.dialog` gốc) mà Modal không cần biết về từng biến thể.
2. **Click ra ngoài (backdrop) để đóng** — kỹ thuật chuẩn cho `<dialog>`: so
   `event.target === chính dialog element` (click lên `::backdrop` hit-test
   rơi vào dialog; click vào nội dung bên trong có target là 1 descendant,
   không khớp). Chỉ đúng vì `.dialog` có `padding: 0` — không có khoảng
   trống "chưa chắc trong hay ngoài" giữa mép dialog và children.

**`SearchModal.tsx`**: `className={styles.searchDialog}` ghim
`margin-top: 96px; margin-bottom: auto` — đè lên `margin: auto` canh giữa
mặc định, giữ nguyên canh giữa NGANG (margin-left/right không đổi). Thêm nút
X (`lucide-react`) cuối ô input, gọi `onClose` trực tiếp.

**Deliverable Phase 21: ĐÃ XONG** — 4 test mới: 2 ở `primitives.test.tsx`
(click thẳng vào dialog → `onClose()`, click vào children → KHÔNG đóng;
`className` gắn thêm đúng không thay thế `.dialog`), 2 ở
`SearchModal.test.tsx` (nút X gọi `onClose()`, click backdrop đóng/click nội
dung không đóng). `npm test` 135/135 pass (từ 131, +4), `npm run typecheck`
sạch, `docker compose up --build` healthy, verify thật qua curl CSS bundle
chứa đúng `margin-top:96px` và class `closeBtn`.

---

## Phase 22 — Restructure Web UI thành package riêng, mirror ranh giới package thật của dsh — ĐÃ BUILD

User hỏi thẳng: cấu trúc dsh không phải "chia package" sao, sao source này
code UI trong đúng 1 folder `apps/web`? Research lại `deepseek-harness/
packages/client/` (chỉ lấy fact cấu trúc, không copy code) xác nhận: dsh
chia UI thành ~15+ package, mỗi package tự khai `inject`/`apply(ctx)`, được
nối bằng 1 hệ thống **module/DI tự quét riêng** (`modules`+`runtime`) — về
bản chất là 1 Cordis-like runtime THỨ HAI chạy trong trình duyệt.

Hỏi lại trực tiếp: mirror TOÀN BỘ (kể cả hệ DI tự quét) hay chỉ ranh giới
package? **User chọn: chỉ ranh giới package** — xây hệ DI tự quét là 1 dự
án hạ tầng MỚI, độ lớn tương đương xây lại 1 phần Cordis cho browser, không
tương xứng quy mô hiện tại (agent-core chỉ có 1 consumer, không có nhiều
app như CLI/desktop/web/VS Code extension của dsh).

**4 package mới** (đúng khuôn `packages/ui-primitives` đã có: `package.json`
+ `src/css-modules.d.ts` + `src/index.ts` barrel + `tests/`):
- `packages/ui-sidebar` — `Sidebar`, `SearchModal`, `sessionHistory.ts`,
  `sidebarState.ts` (chuyển nguyên từ `apps/web/src`, không đổi hành vi).
- `packages/ui-conversation` — `MessageBubble`, `Composer`, `ToolRow`,
  `GenericToolCard`, `EmptyState`, `AssistantMarkdown` (chuyển nguyên) +
  `StreamingRow` (component MỚI, trích từ 1 div inline trong `App.tsx`).
- `packages/ui-settings-general` — `settings.ts` (chuyển nguyên) +
  `SettingsForm` (component MỚI, trích từ JSX form inline trong `App.tsx`
  — Modal bọc ngoài vẫn ở lại `App.tsx`, đây chỉ là nội dung form).
- `packages/ui-layout` — `AppFrame` (component MỚI, trích từ JSX khung
  ngoài `#app`/`#main`/`header`/`#messages` của `App.tsx`) — shell THUẦN,
  nhận `sidebar`/`header`/`footer`/`children` qua props, KHÔNG hardcode bất
  kỳ nội dung app-specific nào (không có text "agent-core", không có
  connection-status markup) — đúng tinh thần `AppFrame` thật của dsh.

**Quyết định phạm vi ghi rõ** (không phải bỏ sót): state/orchestration của
conversation (`connect`/`applyStep`/`reconstructItems`/`handleSubmit`, state
`ChatItem[]`) **ở lại `apps/web/src/App.tsx`** — KHÔNG tách thành 1
"controller" riêng như `ConversationController` thật của dsh, vì cần thiết
kế API prop/callback xuyên suốt sidebar/settings/conversation mà không có
lợi ích thật ở quy mô 1 consumer/1 conversation view duy nhất.

**Gap thật phát hiện lúc đọc `Dockerfile`** (không phải giả định): stage
`deps` `COPY` từng `package.json` của workspace member RIÊNG LẺ trước
`npm ci` (không copy cả `packages/`) — thêm 4 dòng `COPY` mới cho 4 package
vừa tạo, thiếu bước này Docker build sẽ không thấy package mới dù
`npm install` ở máy dev vẫn chạy bình thường bên ngoài container.

**Tài liệu mới**: [`docs/agent-core-ui-architecture.md`](./agent-core-ui-architecture.md)
— sơ đồ dependency giữa các package, quy ước scaffold 1 package UI mới, lý
do quyết định phạm vi — dùng làm tham chiếu lâu dài cho package UI thêm sau
này, không phải chỉ ghi lại lịch sử phase này.

**Deliverable Phase 22: ĐÃ XONG** — thuần di chuyển file (relocation), KHÔNG
đổi hành vi — `npm test` vẫn đúng 135/135 (không đổi số lượng, chỉ đổi vị
trí file test), `npm run typecheck` sạch, `docker compose up --build`
healthy, verify thật qua curl bundle build ra từ cấu trúc multi-package mới
vẫn phục vụ đúng.

---

## Phase 23 — Sidebar: nhóm lịch sử theo ngày (Hôm nay/Hôm qua/dd-MM) — ĐÃ BUILD

Follow-up cho sidebar: user muốn list lịch sử hội thoại nhóm theo ngày kiểu
dsh — "Hôm nay"/"Hôm qua"/ngày cụ thể — thay vì 1 list phẳng.

**`packages/ui-sidebar/src/groupSessionsByDate.ts` (MỚI)** — hàm thuần, nhận
`now: Date` qua tham số (mặc định `new Date()`, không gọi `Date.now()`
thẳng bên trong) để test được xác định. Gom theo `startOfDay` khớp hôm
nay/hôm qua, còn lại lấy nhãn ngày cụ thể. `sessions` đầu vào PHẢI đã sắp
mới nhất trước (đúng thứ tự `addSessionToHistory()` đảm bảo sẵn) — hàm chỉ
gom nhóm theo thứ tự lần đầu gặp, không tự sắp xếp lại.

**Gap thật phát hiện lúc viết test** (không đoán, verify bằng chạy test
thật): `toLocaleDateString('vi-VN', ...)` cho ra 2 định dạng KHÁC NHAU tuỳ
có tham số `year` hay không — bỏ `year` → dùng dấu gạch ngang ("15-08"), có
`year` → dùng dấu gạch chéo ("31/12/2025") — cùng 1 locale nhưng 2 separator
khác nhau, sẽ đọc không nhất quán trên UI thật, và có thể khác nhau giữa
máy dev với dữ liệu ICU của container Docker. Sửa bằng tự ráp chuỗi
`dd/MM`/`dd/MM/yyyy` thủ công (`pad2()`), không dùng `toLocaleDateString`
cho phần ngày cũ hơn hôm qua nữa — đảm bảo luôn đúng 1 định dạng, không phụ
thuộc runtime.

`Sidebar.tsx` chỉ áp dụng nhóm này cho list chính, **KHÔNG** áp dụng cho
`SearchModal` (đang tìm theo từ khoá thì gom theo ngày không có ý nghĩa,
kết quả vốn đã lọc theo mức độ liên quan — quyết định phạm vi có chủ đích).

**Deliverable Phase 23: ĐÃ XONG** — `packages/ui-sidebar/tests/
groupSessionsByDate.test.ts` (MỚI, 6 test: cùng ngày hôm nay, hôm qua, ngày
cụ thể cùng năm không kèm year, khác năm có kèm year, giữ đúng thứ tự nhóm,
mảng rỗng) + 1 test mới trong `Sidebar.test.tsx` (session tạo "hôm nay"
hiện đúng dưới nhãn "Hôm nay"). `npm test` 142/142 pass (từ 135, +7), `npm
run typecheck` sạch, `docker compose up --build` healthy, verify thật qua
curl CSS bundle chứa đúng class `dateGroupLabel`.

---

## Phase 24 — Auth thật nhiều người dùng: Postgres, username/password, role admin/user, admin panel — ĐÃ BUILD

User: storage/memory production-ready chưa để thêm module Auth quản lý user
+ UI. Quyết định giữa chừng: `bundles/providers/auth-apikey` (shared key
phẳng) **thay thế hoàn toàn**, không mở rộng — schema SQLite ban đầu đề
xuất bị bác ngay khi thấy nhỏ, chốt dùng **Postgres** riêng cho user/token
(KHÔNG đụng SQLite của `ctx.storage`, event log hội thoại vẫn nguyên).

**`seams/auth.ts`** rewrite (breaking): `verify()` từ `boolean` đồng bộ
thành `Promise<AuthIdentity | undefined>` bất đồng bộ — bắt buộc vì
Postgres qua `pg` là promise-based. Thêm `signup`/`login`/`logout`/
`listUsers`/`setRole`/`setActive`/`deleteUser`, tất cả async. `Session`
(seams/loop.ts) + `CreateSessionOptions` (seams/sessions.ts) thêm
`ownerId?: string` — set DUY NHẤT bởi adapter từ identity đã verify, không
bao giờ tin trường do client tự khai trong body (coding rule B1).

**`bundles/providers/auth-users`** (MỚI, thay `auth-apikey` đã XOÁ) —
`pg.Pool`, 2 bảng `users`/`auth_tokens` (`ON DELETE CASCADE`),
`scryptSync`+`timingSafeEqual` cho mật khẩu, token bearer opaque
(`randomBytes(32)`) tra theo `sha256(token)` (không lưu raw token). User
đầu tiên ký hiệu ngay thành `admin` (bootstrap), còn lại mặc định `user`.
Guard "admin cuối cùng": chặn hạ quyền/deactivate/xoá nếu đó là admin
active cuối cùng còn lại.

**Endpoint mới**: `POST /auth/signup|login|logout`, `GET /sessions` (chỉ
sessions của chính actor), `GET/PATCH/DELETE /users` (chỉ admin, gate qua
`ctx.permission.check(role, 'admin:users:manage')` — **seam permission
không đổi gì**, RBAC đã đủ tổng quát từ Phase 2). Fix an ninh thật:
`canAccessSession(identity, session)` thêm vào cả 3 adapter (REST/WS/gRPC)
— trước đó bất kỳ token hợp lệ nào cũng đọc được session của người khác,
đã verify bằng curl thật ra 403 đúng chỗ.

`docker-compose.yml` thêm service `postgres:16-alpine` (`depends_on:
condition: service_healthy`, named volume `agent-core-postgres-data`).
Frontend: `packages/ui-primitives/TextField.tsx` (mới), package
`packages/ui-auth` (`LoginForm`/`SignupForm`/`AdminUsersPanel`/
`authState`/`authApi`), `Sidebar.tsx` thêm user row + trigger admin panel,
`App.tsx` thêm gate `if (!auth) return <LoginForm/>|<SignupForm/>` (đặt
SAU mọi hook, không vi phạm rules-of-hooks).

**Deliverable Phase 24: ĐÃ XONG** — test Postgres cô lập theo
`CREATE DATABASE`/`DROP DATABASE` mỗi test (`CREATE SCHEMA`+`search_path`
đã thử trước, KHÔNG hoạt động đáng tin cậy với `pg.Pool`, verify bằng lỗi
Postgres thật). `npm test` 170/170 pass, `npm run typecheck` sạch. Verify
thật qua curl: signup đầu → admin, signup thứ 2 → role `user`, 403 chéo
user thường trên `/users` và trên session người khác, 200 + đổi role cho
admin. Tài khoản `admin`/`Ab@123456` đã seed thật, 4 tài khoản test dọn qua
đúng `DELETE /users/:id`. Commit `06e6d39` (113 file, không kèm
Co-Authored-By theo yêu cầu riêng của user — user tự commit dưới danh
tính git của họ).

---

## Phase 25 — Tích hợp `ctx.memory` với TencentDB Agent Memory (MemoryCore) — ĐÃ BUILD

User: tập trung phần tích hợp với memory như đã plan (xem
`docs/agent-core-memory-integration-plan.md` cho bối cảnh đầy đủ — vì sao
chọn MemoryCore, kiến trúc đề xuất, 4 quyết định đã chốt, rủi ro).
MemoryCore (`memory-db/MemoryCore`, MIT, Tencent, port 8420) — chỉ dùng
thành phần L0 (raw conversation + BM25 search)/L1 (fact extraction nền);
KHÔNG dùng MemoryKnowledge/MemoryPanel/MemoryProxy (không cần, agent-core
đã tự ráp prompt riêng).

**`seams/memory.ts`** thêm `MemoryContext { userId?: string }` — `remember`/
`recall` giờ nhận thêm context tuỳ chọn, map từ `Session.ownerId` để cô lập
theo từng người dùng thật (không phải theo `sessionId` suông).

**`bundles/providers/memory-tencentdb`** (MỚI) — wrap SDK chính thức
`@tencentdb-agent-memory/memory-sdk-ts-v2`, dùng `V3MemoryClient`
(strict-isolation: bind `teamId`/`agentId` cấp deployment lúc khởi tạo,
`withIsolation({ userId })` phái sinh client theo từng user per-call, KHÔNG
tạo 1 client/user). Timeout (coding rule A17): đã đọc thẳng
`node_modules/.../dist/http.js` xác nhận `HttpTransport` tự có
`AbortController` quanh mỗi fetch, không cần bọc thêm lớp giả.
`remember()`/`recall()` best-effort tuyệt đối — lỗi/timeout chỉ log rồi
nuốt (remember) hoặc trả mảng rỗng (recall), KHÔNG BAO GIỜ throw lên loop
driver (memory là enhancement, không nằm trên critical path của turn).

**Nối vào loop thật** — tái dùng ĐÚNG cơ chế `extraSystemNotes` đã xây cho
skill (Phase 15), không phát minh cơ chế ráp prompt mới (coding rule B6):
`loop-default`/`loop-planner-critic` gọi `ctx.memory?.recall(...)` rồi gộp
kết quả vào cùng mảng `extraSystemNotes` với skill instructions.
`bundles/providers/agent-runner` gọi `ctx.memory?.remember(...)` ngay sau
khi ghi event `user_message` — KHÔNG await (nền, không chặn latency turn),
có `.catch(() => {})` vì `serve.ts` có
`process.on('unhandledRejection', ...) => process.exit(1)` cho toàn
service. `'memory'` KHÔNG có trong `inject` của agent-runner/loop-driver —
seam optional có chủ đích.

**Gap thật #1 phát hiện qua verify Docker end-to-end thật** (không phải giả
thuyết, không phải test đơn vị): dù `memory-tencentdb` đã mount thành công
(log "ready" hẳn hoi) và cấu hình đúng 100%, `remember()`/`recall()` gọi
qua `agent-runner`/`loop-default` KHÔNG BAO GIỜ thực sự tới được provider —
xác nhận bằng cách gửi tin nhắn thật qua REST rồi xem log request thật của
container `memory-core`: không có request nào cả. Nguyên nhân: đọc property
`ctx.memory` trực tiếp THROW ("cannot get property \"memory\" without
inject") ngay cả khi service ĐÃ mount ở nơi khác trong app — Cordis gate
truy cập theo `inject` của ĐÚNG fiber đang đọc (spatial composability), không
theo "có tồn tại đâu đó trong app hay không". try/catch bọc ngoài (bản đầu
tiên) NUỐT ÂM THẦM lỗi này mỗi lần, im lặng vô hiệu hoá toàn bộ tính năng.
Fix: dùng `ctx.get('memory', strict?)` — API chính thức của Cordis
(`node_modules/@deepseek-ai/cordis/src/reflect.ts`) đọc service KHÔNG cần
khai inject, trả `undefined` êm ái nếu chưa mount — đúng cơ chế "optional
dependency" Cordis cung cấp sẵn, áp dụng ở cả `bundles/providers/agent-runner`
và cả 2 loop driver, bỏ hẳn lớp try/catch tự chế không cần thiết nữa.

**Gap thật #2 phát hiện cùng đợt verify** (cũng thực nghiệm, không phải giả
thuyết): sau khi fix gap #1, `recall()` trả về ≥2 kết quả khiến
`buildPrompt()` (bản cũ, Phase 15) chèn 2 message role `'system'` RIÊNG BIỆT
— proxy Qwen (vLLM/litellm) trả 400 thật: `"System message must be at the
beginning."`, xác nhận bằng curl trực tiếp vào proxy với 2 message system.
Bug này CÓ TỪ Phase 15 (chỉ chưa lộ ra vì repo trước đó chỉ có đúng 1 skill,
chưa từng có tình huống ≥2 note cùng lúc). Fix chung tại `seams/loop.ts`
`Session.buildPrompt()`: gộp system prompt gốc (nếu có) + toàn bộ
`extraSystemNotes` thành ĐÚNG 1 message role `'system'` duy nhất ở đầu mảng
(nối bằng `\n\n`), không bao giờ phát sinh message system thứ 2 nữa bất kể
bao nhiêu skill/memory note khớp cùng lúc. 3 test mới trong
`tests/session-lifecycle.test.ts` khoá lại hành vi này.

**Docker/serve.ts (mới trong phase này)**: `docker-compose.yml` thêm
service `memory-core` (image `agentmemory/memory-core:latest`, xác nhận
thật qua `docker inspect` là image có sẵn HEALTHCHECK riêng cổng 8420,
không cần định nghĩa lại; KHÔNG có `depends_on` giữa `agent-core` và
`memory-core` — cả 2 start song song, memory-tencentdb tự resilient nên
không cần đợi đồng bộ như Postgres). `src/serve.ts` mount `ctx.memory`
HOÀN TOÀN tuỳ chọn: chỉ khi `MEMORY_CORE_URL`+`MEMORY_CORE_API_KEY` được
set (thiếu 1 trong 2 → exit(1) lúc boot, set đủ cả 2 hoặc bỏ trống cả 2);
trước khi mount, tự gọi bootstrap 1 lần
`POST /v3/internal/meta/user/init-admin` (idempotent — 409 vẫn tính là
thành công) với retry-with-backoff (5 lần) vì thiếu `depends_on` đồng bộ;
bootstrap thất bại hẳn KHÔNG làm service exit(1) — chỉ log cảnh báo rồi bỏ
qua việc mount, agent-core vẫn chạy đầy đủ chức năng khác (đúng triết lý
memory optional xuyên suốt).

**Gap thật #3** (cũng phát hiện qua log Docker thật của chính container
`memory-core`, không phải đọc source suông): request bootstrap ban đầu
(chỉ gửi body `{username, user_key}`) bị MemoryCore trả 400
`"missing_instance_id"`. Đọc thẳng
`memory-db/MemoryCore/src/metadata/router/instance.ts` xác nhận route
`/v3/internal/meta/user/init-admin` resolve `instance_id` TỪ HEADER
`x-tdai-service-id` (không phải field body) — fix bằng cách thêm header đó
vào request bootstrap, dùng đúng giá trị `MEMORY_CORE_SERVICE_ID`.

**Deliverable Phase 25: ĐÃ VERIFY THẬT qua `docker compose up --build`** (3
container: postgres/agent-core/memory-core, cả 3 healthy, log
`[memory-tencentdb] ready`) **+ 1 lượt remember→recall thật qua curl REST**:
tin nhắn 1 nêu 1 sự thật ("màu yêu thích là màu tím") → tin nhắn 2 hỏi lại
trong CÙNG session → model trả lời đúng "tím" (nhớ lại thành công qua
memory-core thật, log request `POST /v3/conversation/search` +
`POST /v3/conversation/add` thật trên container `memory-core`). Verify thêm
cô lập theo user: user khác, session khác, hỏi cùng câu → model trả lời
đúng "không biết" (KHÔNG rò rỉ memory giữa các user). `npm test` 180/180
pass (từ 170: +7 `tests/memory-tencentdb.test.ts`, +3
`tests/session-lifecycle.test.ts` cho gap #2), `npm run typecheck` sạch.
4 tài khoản test tạo trong lúc verify đã dọn qua đúng `DELETE /users/:id`.

---

## Phase 26 — Security audit thật (authn/authz toàn plugin) + plan rate-limiting — ĐÃ AUDIT, CHƯA IMPLEMENT

User: "Lên plan update rate limit cho API và kiểm tra security cho authen
author của các plugin" — audit là hành động thật (đã đọc từng file, không
đoán), rate-limit chỉ dừng ở plan (chưa implement). Toàn bộ chi tiết
(finding, file:line, kịch bản khai thác, fix đề xuất, thiết kế seam
`ctx.ratelimit` + provider + số cụ thể từng endpoint) nằm ở
[`docs/agent-core-rate-limit-and-security-audit.md`](agent-core-rate-limit-and-security-audit.md)
— không lặp lại ở đây, chỉ tóm tắt mức độ:

- **[CAO] A1**: `tool-database-query` đọc được transcript của BẤT KỲ
  session nào qua tool-call, không check ownership — bỏ qua hoàn toàn lớp
  `canAccessSession()` đã build cho REST/WS/gRPC. Gốc rễ: `ToolHandler`
  (seams/tools.ts) không có tham số session/identity.
- **[CAO] A2**: ownership chỉ tồn tại ở `ctx.sessions` (in-memory, TTL
  sweep) — `ctx.storage` (SQLite) không có khái niệm chủ sở hữu, cộng với
  REST/gRPC cho phép client tự chọn session id → 1 user có thể "nhận" lại
  id đã bị sweep của user khác và đọc được transcript cũ của họ.
- **[CAO] A3**: `login()` timing side-channel (chỉ chạy `scryptSync` khi
  username tồn tại) — lộ được username hợp lệ dù message lỗi cố tình chung
  chung.
- **[CAO] A4**: không có rate-limiting ở bất kỳ đâu — brute-force + DoS tự
  gây ra qua chính `scrypt` (cố tình tốn CPU) trên `/auth/login`/`/auth/signup`.
- **[TRUNG BÌNH] A5**: handler lỗi chung echo thẳng `err.message` cho MỌI
  lỗi 500 chưa lường trước — rò rỉ chi tiết nội bộ tiềm ẩn.
- **[TRUNG BÌNH] A6**: gRPC chạy `createInsecure()` — token đi plaintext
  (đã biết từ mục "Rủi ro cần theo dõi", nhắc lại cụ thể hơn ở đây).
- **[THẤP] A7/A8**: `memory-tencentdb` fallback `'anonymous'` là dead code
  hiện tại nhưng là bẫy tiềm ẩn; chính sách mật khẩu chỉ có độ dài tối
  thiểu (chấp nhận được, không phải lỗi, miễn A4 được xử lý).

A1/A2 nên xử lý ĐỘC LẬP, không phụ thuộc rate-limit — rate-limit làm chậm
kẻ tấn công, không thay thế việc đóng đúng lỗ hổng authz.

**Deliverable Phase 26**: 1 doc audit đầy đủ + 1 plan rate-limiting đầy đủ
(seam `ctx.ratelimit`, provider `ratelimit-memory`, bảng limit cụ thể theo
endpoint, thứ tự build 6 bước). **CHƯA implement bất kỳ finding hay
rate-limit nào** — đúng scope user yêu cầu ("lên plan" cho rate limit),
chờ quyết định của user về việc triển khai (đặc biệt A1 đổi signature
`ToolHandler`, ảnh hưởng mọi tool bundle hiện có).

---

## Timeline đề xuất (tham khảo, điều chỉnh theo tốc độ thật của bạn)

| Phase | Nội dung                                                                 | Ưu tiên                                   |
| ----- | ------------------------------------------------------------------------ | ----------------------------------------- |
| 0     | Setup, chạy được dsh gốc                                                 | Bắt buộc trước tiên                       |
| 1     | Định nghĩa seam                                                          | Bắt buộc — sai ở đây làm hỏng mọi thứ sau |
| 2     | Temporal composability + test                                            | Bắt buộc                                  |
| 3     | Spatial composability + test (đúng ví dụ Tool A/B, Subagent C/D bạn đưa) | Bắt buộc — đây là core yêu cầu            |
| 4     | Agent loop + tool Python thật                                            | Sau khi 1-3 pass test                     |
| 5     | Chaos test hot-swap toàn hệ thống                                        | Cuối cùng, xác nhận tổng thể              |
| 6     | API layer: `ctx.sessions` + `agent/step` → REST → WS stream → gRPC (tuỳ cần) → production hardening (6.4) | Sau khi Phase 0-5 pass — bọc core thành backend service |
| 7     | Web UI demo (`bundles/adapters/web-ui`) + CORS + WS query-param auth + Docker | Sau khi Phase 6 pass — demo trực quan + đóng gói triển khai |
| 8     | Session/history lifecycle, LLM retry, storage retention, UI plugin-driven rendering | Sau audit production-readiness trên bản deploy thật |
| 9     | Web UI: slot-registry thật (`ctx.slots`), React + Vite, parity cấu trúc với dsh | Đổi kiến trúc lớn — làm sau khi xác nhận rõ đánh đổi (React, npm workspaces, build stage Docker mới) |
| 10    | Design-system thật của dsh (token 3 tầng, bubble, Button) + rebrand cam/trắng/đen — ĐÃ BUILD | Sau Phase 9 — thị giác, không đổi kiến trúc plugin |
| 11    | Audit fix: timeout cho tool-web-search + Error Boundary cho RenderSlot — ĐÃ BUILD | Đối chiếu docs/agent-core-master-summary.md, 2 gap thật rẻ, ưu tiên cao |
| 12    | `packages/ui-primitives`: Modal/Tooltip/Toast/Pill/StateDot + dọn Button — ĐÃ BUILD | Chỉ phần design-system dùng chung thật áp dụng được, không clone feature-specific |
| 13    | Sidebar + lịch sử session (client-side) + fix 2 gap persist backend (`user_message`, `toolUi`) — ĐÃ BUILD | Sau Phase 12 — layout 2 cột giống dsh, chỉ làm sau khi có nội dung thật để hiện |
| 14    | Sidebar thu gọn được (rail icon-only) + list lịch sử mượt hơn + trigger "Cấu hình" cuối sidebar (đọc source thật dsh, viết lại 100% code mới) — ĐÃ BUILD | Phản hồi UI Phase 13 chưa đúng cấu trúc dsh |
| 15    | `ctx.skills` (skill-plugin, seam mới) + ví dụ `skill-support-tone` + fix index/WAL cho `ctx.storage` — ĐÃ BUILD | Audit user: "skill"/"memory" đâu, storage production-ready chưa |
| 16    | Redesign UI: token scale spacing/radius/typography/shadow/motion đầy đủ + gộp `style.css` về CSS Modules + composer textarea/empty-state/streaming-indicator/focus-visible — ĐÃ BUILD | User: UI chưa clean, không giống 1 sản phẩm hoàn thiện |
| 17    | Sidebar: logo + search cuộc trò chuyện (client-side filter) — ĐÃ BUILD | Follow-up nhỏ sau Phase 16 |
| 18    | Icon thật (`lucide-react`) thay glyph text, icon open/close sidebar riêng — ĐÃ BUILD | User: icon đang dùng text, muốn 1 bộ icon thật |
| 19    | Tooltip: luôn hiện dưới, nền xám, portal thoát clipping của ancestor `overflow: hidden` — ĐÃ BUILD | User: tooltip bị cắt mất, cần below + nền xám + z trên cùng |
| 20    | Search chuyển sang modal giữa màn hình (blur backdrop) + debounce + skeleton — ĐÃ BUILD | Follow-up thứ 2 cho search (sau Phase 17) |
| 21    | SearchModal: ghim vị trí trên (chống nhảy), nút X đóng, click-outside đóng — ĐÃ BUILD | Follow-up thứ 3: modal nhảy vị trí + chưa đóng được ngoài Esc |
| 22    | Restructure Web UI: 4 package mới (ui-sidebar/ui-layout/ui-conversation/ui-settings-general), mirror ranh giới package thật của dsh — ĐÃ BUILD | User: sao cấu trúc dsh chia package mà source này chỉ 1 folder web |
| 23    | Sidebar: nhóm lịch sử theo ngày (Hôm nay/Hôm qua/dd-MM) — ĐÃ BUILD | User: list history chưa có filter theo ngày như dsh |
| 24    | Auth thật nhiều người dùng: Postgres, role admin/user, admin panel — ĐÃ BUILD | User: cần module Auth quản lý user + UI, Postgres thay SQLite |
| 25    | Tích hợp `ctx.memory` với TencentDB Agent Memory (MemoryCore) — ĐÃ BUILD | User: tập trung phần tích hợp với memory như đã plan |
| 26    | Security audit thật (authn/authz) + plan rate-limiting — ĐÃ AUDIT | User: lên plan rate limit + kiểm tra security authn/authz các plugin |

## Rủi ro cần theo dõi trong quá trình build

- **API `@deepseek-ai/cordis` đang phát triển tích cực, chưa ổn định, có thể đổi mà không báo trước** — đây là cảnh báo chính thức từ repo gốc, không phải suy đoán. Ghim đúng version trong `package.json` (không dùng `^` lỏng lẻo cho package này), đọc CHANGELOG trước khi bump version.
- **Không có sẵn hạ tầng của dsh** — `ctx.tools`, `ctx.sessions`, `ctx.web`, MCP client wiring, Web UI, Trajectory view đều là tính năng ứng dụng dsh xây trên Cordis, không phải của framework Cordis. Việc "npm install @deepseek-ai/cordis" chỉ cho bạn core DI + lifecycle — toàn bộ seam nghiệp vụ (Phase 1) là bạn tự thiết kế, không có sẵn để tham chiếu.
- **MCP client cũng cần cài riêng** (`@deepseek-ai/dsh-mcp-client`) nếu muốn dùng lại đúng pattern mount tool Python đã bàn — package này tách biệt khỏi core `@deepseek-ai/cordis`, kiểm tra tương thích version giữa 2 package trước khi dùng chung.
- **MCP server (Python) không được sandbox tự động** — nhắc lại từ phần trước, tự chịu trách nhiệm an toàn cho code Python bạn viết làm tool.
- **`fiber` là tên đơn vị scope trong Cordis** (không phải "fork scope" như cách gọi ước lệ ở các phần trước) — dùng đúng thuật ngữ này khi đọc lỗi/log/API docs để tra cứu chính xác.
- **Phase 6 thêm dependency mới ngoài hệ sinh thái Cordis** (`ws`, `@grpc/grpc-js`, `@grpc/proto-loader`) — không có cảnh báo "chưa ổn định" như `@deepseek-ai/cordis`, nhưng vẫn nên ghim version cụ thể vì đây là code chạy network-facing (bề mặt tấn công thật, không phải nội bộ in-process như Phase 0-5).
- **REST/WS/gRPC lắng nghe network thật = bề mặt cần permission/rate-limit/auth trước khi chạy production** — `permission-rbac` (Phase 2) mới chỉ check theo actor/action nội bộ, chưa có khái niệm "request từ ai qua network". Trước khi expose ra ngoài môi trường dev, cần thêm lớp auth ở adapter (API key / JWT / mTLS cho gRPC) — nằm ngoài scope Phase 6 hiện tại, phải làm rõ trước khi deploy thật.
