# Plan hợp nhất `feat/rlm-harness-migration` vào `dev`

> **Cập nhật: ĐÃ MERGE THẬT, đã verify end-to-end qua Docker.** Thứ tự thực
> hiện đúng theo mục 5, cả 2 điểm cần quyết định (mục 6) đã chọn theo
> khuyến nghị: tách `ctx.turnMemory` riêng khỏi `ctx.memory`, và tách sudo/
> OpenCode CLI sang riêng `Dockerfile.dev` (không đụng `Dockerfile` chính
> dùng cho production). Chi tiết đầy đủ (gap thật phát hiện lúc build/chạy
> Docker thật, không có trong bản dự đoán ban đầu) ở mục 8 cuối doc.

Đã `git fetch origin`, tìm thấy `origin/feat/rlm-harness-migration` (không
tồn tại local trước đó). Đã chạy thử **merge thật** (`git merge --no-commit
--no-ff` trên 1 branch tạm, sau đó `git merge --abort` + xoá branch tạm —
KHÔNG đụng gì tới `dev`) để lấy đúng danh sách conflict thật từ chính git,
không đoán. Doc này ghi lại: nhánh đó có gì, xung đột thật ở đâu/vì sao, và
thứ tự làm để hợp nhất an toàn.

## 1. Nhánh đó là gì

`feat/rlm-harness-migration` (4 commit, rẽ nhánh từ `c7ffd665` — commit thứ
2 của repo, TRƯỚC CẢ module Auth/Postgres và trước toàn bộ việc Memory/
security audit tôi vừa làm) biến `agent-core` từ "harness demo" thành 1
**data-agent RLM đa lượt có UI/deploy độc lập**:

- **`loop-rlm`** — loop driver thứ 3 (bên cạnh `loop-default`/
  `loop-planner-critic`), không gọi LLM trực tiếp mà bridge sang 1
  **Python worker persistent per-session** (`sandbox-ipython`/
  `sandbox-docker`) chạy `HarnessRLM` (vendor nguyên core RLM kèm license
  gốc tại `python/vendor/rlm/`) — REPL Python thật, đa iteration, subcall,
  context compaction, trajectory.
- **4 seam mới**: `ctx.workspace` (dataset/file theo session — local hoặc
  Docker volume), `ctx.sandbox` (quản lý process/container Python
  persistent + protocol event), `ctx.prompts` (ghép system prompt từ nhiều
  Markdown section có `order`, tạo version hash), và **mở rộng
  `ctx.memory`** (rolling summary theo session, semantic qua LLM, dùng để
  nén ngữ cảnh cho RLM — KHÁC HẲN mục đích `ctx.memory` tôi vừa build).
- **`ctx.tools` thêm `invoke(name, args, {sessionId, source})`** — 1 cổng
  execution chung cho mọi loop (kể cả Python REPL gọi ngược qua
  `__host_tool__`), có track `source: 'default-loop'|'planner-critic'|
  'rlm'|'subagent'`.
- Bridge model call: Python `HostLlmClient` không giữ API key, phát event
  `__host_llm__` để TypeScript tự gọi `ctx.llm.complete()` — key chỉ nằm ở
  TS, đúng nguyên tắc "Python không giữ secret" họ tự đặt ra.
- ~20 skill data-science thật (`bundles/skills/{data-scientist,pandas-expert,
  explore-data,validate-data,statistical-analysis,...}`) + benchmark suite
  riêng (`benchmarks/rlm/`, có fixture CSV thật, DABench, `run.py`).
- REST thêm `/sessions/:id/files` (upload/download/list dataset), `/skills`
  (catalog), `send_message` nhận thêm `selectedSkill`/`metadata`.
- Docker: vendor nguyên Python 3.11 + scientific stack (kể cả `torch` CPU)
  vào image, `Dockerfile.dev`/`docker-compose.dev.yml` cho hot-reload,
  `docker-compose.prod.yml` cho production riêng.

Tài liệu riêng của họ giải thích đầy đủ hơn (đã đọc toàn bộ, không phải chỉ
lướt): `docs/system-architecture.md` (666 dòng) và
`docs/frontend-backend-handoff.md` (487 dòng) trên chính branch đó.

**204 file thay đổi, +38997/-73 dòng** — nhưng phần lớn (skill Markdown,
fixture CSV, `python/vendor/rlm/`, `benchmarks/rlm/fixtures/`) là **file mới
hoàn toàn, không đụng gì tới `dev`** — không phải nguồn gốc conflict.

## 2. Vì sao conflict — 21 file cả 2 bên cùng sửa, 13 file có conflict marker thật

Nhánh RLM rẽ ra TRƯỚC khi `dev` có: module Auth/Postgres nhiều người dùng
(Phase 24), tích hợp `ctx.memory` với TencentDB (Phase 25), và audit
security (Phase 26). Cả 2 bên độc lập sửa CÙNG những file lõi nhất của hệ
thống — đây là gốc rễ duy nhất của mọi conflict, không phải lỗi thao tác gì.

`git merge --no-commit --no-ff` cho kết quả thật:

- **8 file auto-merge sạch** (không marker, nhưng cần review kỹ vì đụng
  logic auth — xem mục 4.2): `.env.example`, `bundles/adapters/api-grpc/
  index.ts`, `bundles/adapters/api-ws/index.ts`, `bundles/providers/
  session-registry/index.ts`, `package-lock.json`, `package.json`,
  `seams/sessions.ts`, `Dockerfile`.
- **13 file có conflict marker thật**, cần quyết định thiết kế:
  `README.md`, `apps/web/src/App.tsx` (5 hunk — nặng nhất), `apps/web/src/
  style.css`, `apps/web/tests/App.smoke.test.tsx`, `bundles/adapters/
  api-rest/index.ts`, `bundles/loop-drivers/loop-default/index.ts`,
  `bundles/loop-drivers/loop-planner-critic/index.ts`, `bundles/providers/
  agent-runner/index.ts`, `docker-compose.yml`, `seams/loop.ts`,
  `seams/memory.ts`, `src/serve.ts`, `tests/api-rest.test.ts`.

## 3. Phát hiện thật trong lúc thử merge (không phải lý thuyết)

### 3.1 Endpoint `/sessions/:id/files` mới KHÔNG có ownership check — cùng lớp lỗ hổng Finding A1/A2 trong audit vừa xong

Sau khi git tự merge `bundles/adapters/api-rest/index.ts`, khối
`GET/POST /sessions/:id/files` (workspace upload/download/list — nguyên
khối mới từ RLM, merge sạch không conflict) đứng NGAY GIỮA 2 endpoint đã
có `canAccessSession(identity!, session)` (`/messages`, `/events`) nhưng
BẢN THÂN nó chỉ check `if (!session) return 404` — **không check
ownership**. Nghĩa là bất kỳ user nào có token hợp lệ đọc/ghi/liệt kê được
file của BẤT KỲ session nào nếu biết/đoán đúng id — đúng hệt Finding A1/A2
đã ghi trong `docs/agent-core-rate-limit-and-security-audit.md`, chỉ là
xuất hiện lại ở 1 endpoint mới. Phải thêm `canAccessSession()` vào đúng chỗ
này khi merge — không phải lỗi "để sau", vì đây là workspace file thật
(dataset khách hàng, output phân tích), rủi ro rò rỉ dữ liệu cao hơn cả
session-events.

### 3.2 `ctx.tools.invoke(name, args, context)` mới KHÔNG thật sự sửa Finding A1

RLM thêm `invoke(name, args, {sessionId, source})` làm "cổng thực thi duy
nhất" — nhưng đọc thẳng `bundles/providers/tool-registry/index.ts` trên
branch đó: `invoke()` NHẬN `context` rồi **bỏ luôn, không truyền cho
handler** (`return tool.handler(args)`). `tool-database-query`'s handler
trên branch đó CŨNG KHÔNG ĐỔI — vẫn đọc `args.sessionId` do model tự cho,
KHÔNG check ownership. Nghĩa là Finding A1 (tool đọc được transcript BẤT KỲ
session nào) **vẫn tồn tại nguyên vẹn** trên nhánh RLM — `context` hiện chỉ
dùng để trace/log (`source` phân biệt loop nào gọi), chưa dùng cho authz.
Tin tốt: hạ tầng để sửa THẬT SỰ đã có sẵn (`ToolInvocationContext` đã mang
`sessionId`) — merge là cơ hội tốt để sửa Finding A1 triệt để luôn (mở rộng
`ToolHandler` nhận thêm context, `query_database` dùng `context.sessionId`
của TURN HIỆN TẠI thay vì tin `args.sessionId` từ model).

### 3.3 `seams/loop.ts` merge sạch gần như hoàn toàn — `TurnInput` sẽ là chuẩn mới

Interface `LoopDriver.runTurn` không bị `dev` đụng tới, nên git giữ nguyên
bản RLM: `runTurn(runCtx, session, input: TurnInput)` thay vì
`(..., userMessage: string)`. `Session` chỉ conflict đúng 1 chỗ nhỏ (field
`createdAt` của tôi vs field `extensions` (Map) của họ — **giữ cả 2, không
loại trừ nhau**, resolve trong 3 dòng). `LoopStep`/`LoopTurnResult` được RLM
mở rộng thêm nhiều union case mới (`analysis`, `code`, `observation`,
`turn_started`, `status: waiting_user`...) — hoàn toàn không đụng gì `dev`
đã có, merge sạch, không cần quyết định gì thêm.

### 3.4 `Dockerfile` (auto-merge, KHÔNG có conflict marker nhưng cần review) thêm sudo passwordless cho user `agent`

```dockerfile
RUN groupadd --gid "${AGENT_GID}" agent \
  && useradd --uid "${AGENT_UID}" --gid agent --create-home --shell /bin/bash agent \
  && printf 'agent ALL=(ALL:ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/agent \
  ...
USER agent
```

Thay thế hoàn toàn khối cũ (`useradd --system ... --shell /usr/sbin/nologin`
+ KHÔNG có sudo) — vốn tôi note rõ trong `dev`: "chạy bằng user không phải
root — giảm bề mặt tấn công". Lý do RLM thêm: OpenCode VS Code extension
cần `sudo` để thao tác quản trị trong container DEV. Nhưng `Dockerfile` này
dùng CHUNG cho cả build production (`docker-compose.yml`) lẫn dev — nếu
merge nguyên trạng, **production image cũng có user non-root NHƯNG có
sudo NOPASSWD** — gần như tương đương root, xoá sạch lớp phòng thủ
"non-root user" tôi đã cố tình build. Cần quyết định: (a) tách hẳn 2
Dockerfile cho dev/prod (RLM đã có sẵn `Dockerfile.dev` — có thể đây chính
là chỗ nên đặt sudo, không phải `Dockerfile` chính dùng cho prod), hoặc (b)
giữ sudo nhưng chỉ trong biến thể dev. Không tự quyết — hỏi user trước khi
merge (mục 6).

Cùng lúc, image thêm `torch` (CPU wheel) + toàn bộ `python/requirements.txt`
— tăng đáng kể thời gian build/kích thước image, cần benchmark thật (build
time, image size) trước khi coi đây là default deploy, không chỉ giả định
"chắc ổn".

## 4. Quyết định thiết kế cần chốt trước khi merge (không phải chỉ resolve text)

### 4.1 `ctx.memory` — 2 capability khác nhau đang tranh 1 tên seam

So `seams/memory.ts` 2 bên:

- **`dev` (Phase 25, đã build + verify Docker end-to-end)**:
  `remember(sessionId, text, context?: MemoryContext)` /
  `recall(sessionId, query, limit?, context?)` — nhớ **xuyên session, xuyên
  turn, cô lập theo USER thật** qua TencentDB Agent Memory (external
  service, semantic search qua BM25).
- **RLM branch**: giữ nguyên `remember`/`recall` (không có `MemoryContext`)
  NHƯNG thêm `snapshot()`/`summary()`/`sourceContexts()`/`recordContext()`/
  `recordTurn()`/`completeTurn()`/`clear()` — **rolling summary theo TỪNG
  SESSION**, mục đích DUY NHẤT là nén `Session.history` thành 1 đoạn tóm
  tắt semantic để nhét vào `PreparedRlmTurn` mỗi lượt (không phải tra cứu
  ngữ nghĩa xuyên session/user).

2 khái niệm khác nhau thật sự (long-term cross-session recall theo user vs
turn-compaction theo session), chỉ trùng TÊN vì phát triển độc lập. Không
thể mount cả 2 provider cùng lúc dưới 1 seam `ctx.memory` (chỉ 1 provider
active cho 1 seam) — provider nào thắng sẽ THIẾU method của bên kia
(`memory-tencentdb` thiếu `snapshot/completeTurn/...` → `loop-rlm` throw;
`memory-rolling` thiếu `MemoryContext` cô lập theo user → mất tính năng
Phase 25 vừa verify).

**Khuyến nghị: TÁCH SEAM**, không ép chung 1 interface:
- Giữ nguyên `ctx.memory` = `MemoryService` của `dev` (remember/recall +
  MemoryContext, provider `memory-tencentdb`) — KHÔNG đổi gì, đã verify
  thật, đừng động vào.
- Đổi tên khái niệm rolling-memory của RLM thành seam MỚI, ví dụ
  `ctx.turnMemory` (`TurnMemoryService`) — đúng tinh thần seam-first "1
  capability rõ ràng = 1 seam" mà chính tài liệu RLM cũng tự đặt ra ở mục
  "Nguyên tắc không được phá". `loop-rlm/protocol.ts` inject `turnMemory`
  thay vì `memory`; provider `memory-rolling` implement `TurnMemoryService`
  thay vì `MemoryService`.
- Việc đổi tên chỉ chạm `loop-rlm`, `memory-rolling`, và seam mới — KHÔNG
  chạm `memory-tencentdb`/`agent-runner`/`loop-default`/
  `loop-planner-critic` đã build+test+verify. Rẻ hơn nhiều so với hợp nhất
  2 interface làm 1.

### 4.2 Auth — RLM chưa từng biết tới Postgres/multi-user, phải re-point toàn bộ endpoint mới

RLM branch KHÔNG đụng `seams/auth.ts` (xác nhận bằng `git diff --stat`) —
toàn bộ code RLM viết trên giả định model auth CŨ (`auth-apikey`, boolean
`verify()`, không có `AuthIdentity`/role/ownership). `dev` đã thay thế
HOÀN TOÀN bằng `auth-users` (Postgres, `AuthIdentity`, `canAccessSession`)
từ Phase 24 — quyết định đã chốt, không quay lại.

Việc cần làm khi merge (không phải "resolve conflict" đơn thuần vì hầu hết
không có marker — auto-merge "sạch" nhưng sạch theo nghĩa git, không phải
đúng theo nghĩa bảo mật):
- Xoá hẳn `bundles/providers/auth-apikey` nếu bản merge vô tình mang nó
  quay lại (branch RLM vẫn còn file này, cần confirm merge kết quả KHÔNG
  restore lại nó).
- MỌI endpoint MỚI từ RLM (`/sessions/:id/files`, `/skills`) phải viết theo
  đúng pattern `identity!`/`canAccessSession()` đã có trong `dev`, không
  phải pattern boolean cũ của RLM — xem 3.1, đây là việc bắt buộc, không
  tuỳ chọn.
- `api-ws`/`api-grpc` auto-merge KHÔNG có conflict marker — PHẢI đọc lại
  toàn bộ 2 file này sau merge để xác nhận không có đường nào từ RLM vô
  tình dùng lại API cũ (`?key=`) thay vì `?token=`/`AuthIdentity` đã build.
- `session-registry`/`seams/sessions.ts` auto-merge sạch — cần xác nhận
  `ownerId` (từ Phase 24) và `extensions`/RLM state (từ nhánh RLM) cùng tồn
  tại đúng trên `CreateSessionOptions`, không cái nào bị auto-merge đè mất.

### 4.3 `apps/web/src/App.tsx` — 5 hunk, 2 bên tái cấu trúc cùng 1 file theo 2 hướng độc lập

Của tôi: gate `if (!auth) return <LoginForm/>|<SignupForm/>`, quản lý
token/logout. Của RLM: upload progress, workspace file panel, gọi
`/sessions/:id/files`, hiển thị dataset/output. Không có cách máy tự resolve
đúng — đây là điểm tốn công nhất trong toàn bộ merge, cần viết lại thủ công
theo đúng cấu trúc gate-trước-mọi-hook đã lập ở Phase 24, rồi lồng UI
workspace của RLM vào NHÁNH ĐÃ ĐĂNG NHẬP. `style.css`/`App.smoke.test.tsx`
đi theo sau khi `App.tsx` xong (thứ tự phụ thuộc, không làm song song được).

### 4.4 Docker sudo (xem 3.4) — cần quyết định của user, không tự chọn

## 5. Thứ tự merge đề xuất (từng bước xanh trước khi qua bước sau — đúng kỷ luật project)

1. **Seams trước** (additive, rẻ, rủi ro thấp): merge `seams/loop.ts` (giữ
   cả `createdAt` lẫn `extensions`), `seams/sessions.ts`, `seams/tools.ts`
   (thêm `invoke`+`ToolInvocationContext`, MỞ RỘNG LUÔN `ToolHandler` nhận
   context — sửa Finding A1 thật trong lúc này, không để "sau"), các seam
   hoàn toàn mới không conflict (`workspace.ts`, `sandbox.ts`, `prompt.ts`).
   Tạo seam mới `turnMemory` theo 4.1, KHÔNG đụng `seams/memory.ts` hiện có
   của `dev`. `npm run typecheck` xanh (chưa cần chạy được, chỉ cần biên
   dịch đúng).
2. **Auth reconciliation**: mang toàn bộ endpoint mới (`/sessions/:id/files`,
   `/skills`) qua `api-rest`, viết lại theo `AuthIdentity`/
   `canAccessSession()` — không copy nguyên bản RLM. Xoá hẳn `auth-apikey`
   nếu còn sót. Đọc lại `api-ws`/`api-grpc` xác nhận không auto-merge sai
   (4.2).
3. **Loop drivers + agent-runner**: hợp nhất `TurnInput` (chuẩn mới) với
   memory-recall (`ctx.get('memory')`, đổi tham số `userMessage` →
   `input.message`) trong `loop-default`/`loop-planner-critic`; hợp nhất
   concurrency-guard (`activeSessions`) của RLM's `agent-runner` với
   remember()-fire-and-forget của tôi. Mount thêm `loop-rlm` (dùng seam
   `turnMemory` mới, KHÔNG dùng `ctx.memory`).
4. **Providers RLM thuần túy mới, không conflict**: `workspace-local`,
   `workspace-docker`, `sandbox-ipython`, `sandbox-docker`, `memory-rolling`
   (đổi sang implement `TurnMemoryService`), `prompt-registry` + skill
   Markdown packages, `skill-filesystem`. Mount trong `src/serve.ts` sau khi
   đã hợp nhất phần composition root (bước này CHÍNH LÀ nơi 2 bên
   `src/serve.ts` conflict — resolve bằng cách giữ đủ mount order cả 2 bên,
   auth-users thay auth-apikey).
5. **Docker/deploy**: quyết định sudo (4.4/3.4) trước, rồi hợp nhất
   `docker-compose.yml` (giữ `postgres`+`memory-core` của `dev`, thêm
   RLM_PYTHON_BIN/RLM_RUNTIME_ROOT của RLM), `.env.example`, `Dockerfile`.
   Build thật `docker compose up --build`, xác nhận cả stack (Postgres +
   memory-core + Python RLM runtime) khởi động healthy — không giả định.
6. **Frontend** (nặng nhất, làm cuối để mọi contract backend đã ổn định):
   `App.tsx` theo 4.3, rồi `style.css`, `App.smoke.test.tsx`.
7. **Test + docs**: `tests/api-rest.test.ts` hợp nhất case ownership
   (`dev`) với case workspace-file (RLM) — PHẢI thêm case "user khác 403
   trên `/sessions/:id/files`" (case này RLM chưa có, đúng gap 3.1).
   `npm run typecheck && npm test` xanh toàn bộ trước khi coi là xong.
   README/build-plan: viết 1 phase mới tổng kết việc hợp nhất (theo đúng
   pattern mọi phase trước), không âm thầm để 2 nguồn sự thật (README của
   `dev` vs README của RLM) lẫn lộn.

## 6. Cần user quyết định trước khi tôi bắt tay làm (không tự chọn)

- **4.1**: đồng ý tách `ctx.turnMemory` riêng khỏi `ctx.memory`, hay muốn 1
  interface hợp nhất cả 2 (tốn công hơn nhiều, và `memory-tencentdb` phải
  tự implement thêm 7 method rolling-specific mà nó không có dữ liệu để trả
  đúng nghĩa)?
- **3.4**: sudo passwordless cho user `agent` trong image — tách riêng
  `Dockerfile.dev` (khuyến nghị) hay chấp nhận sudo cả production?
- Có muốn tôi bắt đầu làm ngay theo thứ tự mục 5, hay chỉ dừng ở plan này
  trước, làm từng bước một và bạn review giữa chừng?

## 7. Flow 1 turn chi tiết + đánh giá mức độ phù hợp với concept plugin của repo

Đọc trực tiếp `bundles/loop-drivers/loop-rlm/index.ts`,
`bundles/providers/sandbox-ipython/index.ts`, và 3 seam mới
(`seams/sandbox.ts`, `seams/workspace.ts`, `seams/prompt.ts`) trên chính
branch đó — không suy diễn từ tài liệu họ tự viết.

### 7.1 Logic branch đó đang làm gì

Biến `agent-core` từ "gọi LLM + tool trực tiếp trong TypeScript" thành **1
harness bọc quanh 1 process Python persistent chạy REPL thật**, dành cho
task data-science đa lượt (upload CSV, phân tích, viết code, xem output,
hỏi lại). Ý tưởng cốt lõi: TypeScript **không** tự viết lại logic
reasoning/REPL của RLM bằng TS — nó coi cả core RLM (Python, vendor nguyên
kèm license upstream) như **một capability ngoài, bọc qua đúng 1 seam**
(`ctx.sandbox`), y hệt cách `llm-qwen` bọc 1 API HTTP ngoài qua `ctx.llm`.

### 7.2 Flow 1 turn, từng bước thật (đọc trực tiếp từ code)

```
Client gửi message (kèm selectedSkill tuỳ chọn)
  → api-rest/ws/grpc → ctx.agent.runTurn('rlm', session, input)
  → AgentRunner pin driver 'rlm' = ctx.loop.get('rlm')
  → loop-rlm.runTurn():
      1. sandbox.openSession(sessionId, {cwd: workspace.root(sessionId)})
         → spawn 1 process Python (nếu chưa có), giữ SỐNG cho tới khi session đóng
      2. prepareRlmTurn() [protocol.ts] — snapshot 1 lần:
         ctx.memory.snapshot() + workspace.inspect() + skills.get() + tools.list()
         + prompts.render() → gói thành PreparedRlmTurn (1 system prompt DUY NHẤT,
         version hash, không nhét state chạy vào system prompt)
      3. sandbox.request(sessionId, 'prepared_turn', prepared)
         → ghi 1 dòng JSON vào stdin của worker.py, đọc stream JSON-lines từ stdout
      4. worker.py chạy HarnessRLM (core RLM thật) — mỗi khi core RLM cần:
         - gọi LLM     → phát __host_llm__  → TS bắt, gọi ctx.llm.complete() thật,
                          trả kết quả lại qua stdin (Python KHÔNG giữ API key)
         - gọi tool    → phát __host_tool__ → TS gọi ctx.tools.invoke() thật
         - đọc skill   → phát __host_skill__ → TS gọi ctx.skills.readResource()
      5. Mỗi step (analysis/code/observation/tool_call/...) được TS ghi
         storage.appendEvent() + emit('agent/step') để WS/gRPC stream live
      6. Worker kết thúc turn → trả outcome/trajectory → loop-rlm gọi
         ctx.memory.completeTurn() (tóm tắt semantic qua chính ctx.llm) → trả
         LoopTurnResult cho adapter
```

Điểm quan trọng: **Python không giữ registry riêng nào** — tool, skill, LLM
key đều nằm ở TS, Python chỉ "hỏi ngược" qua đúng 3 loại event trên. Đây là
nguyên tắc họ tự đặt ra (mục "Nguyên tắc không được phá" trong
`docs/system-architecture.md` của chính branch đó) và tuân khá nghiêm.

### 7.3 Có phù hợp với concept plugin của repo này không

**Phù hợp thật, không phải chỉ nói suông:**

- 3 seam mới (`sandbox`/`workspace`/`prompt`) đều đúng khuôn
  `abstract class X extends Service` + `inject`/`apply` + effect-scoping —
  giống hệt cách `seams/llm.ts`/`seams/storage.ts` đã làm từ Phase 1, không
  lệch convention.
- `loop-rlm` đăng ký qua `ctx.loop.register('rlm', ...)` — **đúng y hệt cơ
  chế hot-swap driver** đã build từ Phase 5 (`loop-default`/
  `loop-planner-critic`), không phải cơ chế riêng. Muốn tắt RLM, chỉ cần
  không mount `loop-rlm` — phần còn lại của hệ thống không biết gì đổi.
- Tool/skill KHÔNG bị nhân bản logic sang Python — `ctx.tools.invoke()`/
  `ctx.skills.readResource()` là **1 cổng duy nhất** dùng chung cho cả loop
  TS lẫn Python REPL. Đúng tinh thần "1 capability, 1 nơi implement" xuyên
  suốt project.

**3 chỗ hở thật, đáng nói rõ (không phải sai concept, mà là thực thi chưa
trọn):**

1. `ToolRegistryService.invoke(name, args, context)` — seam ĐỊNH NGHĨA
   nhận `context: {sessionId, source}`, nhưng provider thật
   (`tool-registry`) **nhận rồi bỏ luôn**, không truyền cho handler (đúng
   Finding A1 đã nêu ở mục 3.2). Seam đúng, implementation chưa theo kịp
   seam của chính nó.
2. `sandbox-ipython.completeToolCall()` lấy `sessionId` để gọi
   `ctx.tools.invoke()` từ **`event.sessionId` — dữ liệu do chính Python
   worker tự báo cáo lại qua JSON**, không phải giá trị TS đã có sẵn và tin
   cậy (chính là session đang mở worker này, đã biết qua closure
   `sessionId` bên ngoài khi `openSession()` được gọi). Nếu sau này
   `sessionId` thật sự dùng để authz (theo fix Finding A1 đề xuất ở mục
   3.2), chỗ này phải sửa cùng lúc — dùng session TS đang giữ, không tin
   field worker tự khai lại.
3. `ctx.memory` — 2 tác giả (2 nhánh) đều làm ĐÚNG theo tinh thần
   seam-first một cách ĐỘC LẬP, nhưng lại định nghĩa 2 capability khác hẳn
   nhau dưới CÙNG 1 tên seam (xem mục 4.1) → khi ráp lại mới lộ xung đột.
   Đây không phải lỗi ai "sai concept", mà là hệ quả tất yếu của 2 nhánh
   không đồng bộ interface trước khi tách ra làm song song.

**Kết luận**: cấu trúc RLM branch tuân thủ mô hình plugin/seam-first của
repo này rất nghiêm túc — có thể nói là bản mở rộng lớn trung thực nhất với
coding rules mà tôi từng thấy trong project này, không có kiểu "viết tắt
cho nhanh rồi phá vỡ ranh giới". Vấn đề khi merge không nằm ở "cấu trúc
sai", mà ở: (a) vài chỗ seam đã đúng nhưng implementation chưa nối hết dây
(mục 7.3.1-2), và (b) 2 interface `ctx.memory` cùng đúng riêng nhưng không
tương thích khi đứng cạnh nhau (mục 4.1). Không có gì ở đây đòi hỏi viết
lại kiến trúc RLM — chỉ cần vá đúng những điểm đã liệt kê trong lúc merge
theo thứ tự mục 5.

---

## 8. Đã merge thật — kết quả, việc đã sửa thêm, gap phát hiện lúc chạy Docker thật

Thực hiện `git merge origin/feat/rlm-harness-migration --no-commit --no-ff`
trên chính `dev` (không phải branch tạm nữa), resolve đủ 13 file có conflict
marker + review kỹ 8 file auto-merge sạch theo đúng thứ tự mục 5.

### 8.1 Quyết định đã chọn (mục 6)

- **`ctx.memory` tách seam** (4.1): tạo `seams/turn-memory.ts` +
  `TurnMemoryService` mới, provider `memory-rolling` đổi sang implement
  seam này (`ctx.turnMemory`, không còn `remember`/`recall` — 2 method đó
  vốn chỉ là fallback nội bộ không liên quan capability chính). `seams/
  memory.ts`/`memory-tencentdb` giữ NGUYÊN, không đổi 1 dòng. `loop-rlm`/
  `protocol.ts` đổi sang `runCtx.get('turnMemory')`.
- **Sudo tách khỏi production image** (3.4/4.4): xoá khối
  `sudo`+`opencode-ai` khỏi `Dockerfile` chính, khôi phục lại
  `useradd --shell /usr/sbin/nologin` (không sudo) như bản `dev` gốc.
  `Dockerfile.dev` (file mới từ RLM, đã tự tách sẵn, không đụng) vẫn giữ
  nguyên sudo cho dev container.

### 8.2 Đã sửa thêm lúc merge (không chỉ resolve text)

- **Finding A1 fix thật** (không chỉ resolve conflict): mở rộng
  `ToolHandler` (`seams/tools.ts`) nhận thêm `context: ToolInvocationContext`,
  `tool-registry.invoke()` truyền context xuống handler,
  `tool-database-query` bỏ hẳn tham số `sessionId` từ model — luôn dùng
  `context.sessionId` (session THẬT của turn đang chạy). `sandbox-ipython.
  completeToolCall()` cũng sửa dùng `state.sessionId` (giá trị TS tin cậy)
  thay vì `event.sessionId` (worker Python tự báo cáo lại — mục 7.3.2).
- **Finding A2 dạng mới fix thật**: khối `/sessions/:id/files` (workspace
  upload/download/list) merge sạch từ RLM nhưng thiếu `canAccessSession()`
  — thêm đúng check như `/messages`/`/events` đã có. 2 test mới xác nhận
  403 cho user khác (`tests/api-rest.test.ts`).
- 2 test cũ (`tests/agent-loop.test.ts`, `tests/rlm-migration.test.ts`)
  từng mã hoá CHÍNH HÀNH VI lỗ hổng Finding A1 làm kỳ vọng test ("query_database
  có thể tra bất kỳ sessionId nào") — viết lại theo hành vi đúng (luôn đọc
  session hiện tại).

### 8.3 Gap thật phát hiện lúc build/chạy Docker thật (không có trong bản dự đoán ban đầu ở mục 3-4)

- **Named volume cũ không ghi được với UID mới**: volume
  `agent-core-data` được tạo từ trước (owner UID 999, từ
  `useradd --system` không chỉ định UID tường minh của `Dockerfile` gốc).
  `Dockerfile` mới của RLM chỉ định `AGENT_UID=1019` tường minh — user mới
  không tạo được thư mục con (`EACCES: permission denied, mkdir
  '/app/data/rlm-memory'`) vì thư mục cha do UID cũ sở hữu. Đây là gap thật
  của MÔI TRƯỜNG (volume tồn tại từ trước khi đổi UID), không phải bug
  code — fix bằng `chown -R` volume 1 lần
  (`docker run --rm -v agent-core_agent-core-data:/data alpine chown -R
  1019:1020 /data`). Đáng lưu ý cho bất kỳ ai upgrade từ image cũ sang
  image có `AGENT_UID` mới trên volume đã tồn tại — không phải vấn đề chỉ
  gặp 1 lần ở máy này.
- **Xoá nhầm lib hệ thống khi tách sudo (mục 8.1) — bug thật do tôi gây
  ra, phát hiện qua chạy 1 turn `driver: "rlm"` thật**: lúc xoá khối
  `apt-get install` (tưởng chỉ phục vụ OpenCode CLI), lỡ xoá luôn
  `libsqlite3-0`/`libreadline8`/`libgdbm6`/`libssl3`/`libtcl8.6`/
  `libtk8.6`/... — đây là runtime dependency THẬT của chính interpreter
  Python 3.11 (numpy/pandas/scipy/matplotlib/ipykernel cần chúng), không
  liên quan OpenCode. Worker Python crash ngay lập tức:
  `libsqlite3.so.0: cannot open shared object file`. Xác nhận bằng cách
  gửi 1 turn thật qua `POST /sessions/:id/messages` với `driver: "rlm"` —
  không phải đọc code suông. Fix: khôi phục nguyên bộ lib (giống hệt danh
  sách trong `Dockerfile.dev`, đã biết chạy tốt), chỉ bỏ đúng gói `sudo` +
  lệnh cài `opencode-ai` — đúng phạm vi quyết định 3.4/4.4, không hơn.

### 8.4 Verify thật đã chạy (không chỉ typecheck/test suite)

- `npm run typecheck` sạch, `npm test` **193/193 pass, 36 file** (từ 180 —
  bao gồm cả test mới của RLM branch lẫn 2 test ownership mới thêm ở 8.2).
- `docker compose build agent-core` thành công (multi-stage: Python 3.11 +
  torch CPU + toàn bộ `python/requirements.txt`, rồi Node runtime).
- `docker compose up` — cả 3 container (`postgres`/`memory-core`/
  `agent-core`) healthy.
- **Turn RLM thật qua Python worker**: signup → tạo session
  `driver: "rlm"` → gửi "2 + 2 bằng mấy?" → nhận đúng `"content":"4"`,
  `"status":"completed"`, kèm `tracePath` trỏ đúng file trace thật trong
  workspace session đó. `data/rlm-memory/<sessionId>.json` (ctx.turnMemory)
  và `data/rlm-workspaces/<sessionId>/` (ctx.workspace) đều được tạo đúng
  — xác nhận bằng `docker exec` đọc trực tiếp filesystem trong container,
  không chỉ tin response.
- **Security fix xác nhận sống**: user B gọi
  `GET /sessions/<id của A>/files` → `403` thật qua curl.
- 4 tài khoản test tạo trong lúc verify đã dọn qua đúng
  `DELETE /users/:id` (API thật, không sửa DB tay).
