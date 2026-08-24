# RLM harness — logic, flow, và cấu trúc các cấu phần mới

Doc này giới thiệu chi tiết mảng lớn nhất được hợp nhất vào `dev` ở Phase 27
(`docs/agent-core-cordis-build-plan.md`) — data-agent RLM đa lượt chạy trên
1 process Python persistent. Khác với `docs/system-architecture.md` (tài
liệu do chính tác giả nhánh RLM viết, tổng quan TOÀN BỘ hệ thống, một số
chỗ đã lỗi thời sau merge — đã vá lại vài điểm), doc này viết SAU merge,
dựa trên đúng trạng thái code hiện tại (đã đọc trực tiếp từng file liên
quan, không suy đoán), tập trung riêng vào các cấu phần MỚI và cách chúng
thật sự vận hành.

Muốn biết vì sao/quyết định thiết kế nào đã chọn lúc merge: xem
`docs/agent-core-rlm-harness-merge-plan.md`. Muốn biết bối cảnh full hệ
thống (auth, memory TencentDB, security audit...): xem
`docs/agent-core-cordis-build-plan.md`.

## 1. RLM là gì, giải quyết vấn đề gì

`loop-default`/`loop-planner-critic` (đã có từ trước) là vòng lặp
tool-calling đơn giản: model trả lời hoặc gọi 1 tool, lặp tới khi xong.
Đủ cho chat thường, nhưng KHÔNG đủ cho task phân tích dữ liệu thật
(nhiều bước, cần chạy code, giữ trạng thái Python giữa các bước, xử lý
dataset lớn, tự sửa lỗi qua nhiều lần thử).

**RLM (Recursive Language Model)** giải quyết đúng việc đó: 1 loop driver
thứ 3 (`loop-rlm`), không tự gọi LLM trực tiếp trong TypeScript, mà bridge
sang **core RLM thật chạy trong Python** — model viết code Python, chạy
trong 1 REPL **persistent** (giữ biến/state giữa các bước và giữa các lượt
chat), quan sát kết quả, lặp lại tới khi có câu trả lời. Core RLM được
vendor nguyên bản (kèm license gốc) tại
`bundles/loop-drivers/loop-rlm/python/vendor/rlm/` — không phải
code tự viết lại, là 1 dependency thật được đóng gói cùng repo.

**Ranh giới rõ ràng, đã verify bằng đọc code**: TypeScript sở hữu MỌI thứ
là "capability của ứng dụng" (session, auth, storage, LLM API key, tool,
skill, permission, memory) — Python CHỈ sở hữu phần gắn chặt với chính
core RLM (REPL, iteration, context compaction, trajectory). Python
**không giữ API key**, **không có registry tool/skill riêng** — mọi thứ nó
cần đều "hỏi ngược" về TypeScript qua 1 giao thức JSON-lines.

## 2. Bản đồ cấu phần mới

| Loại | Tên | Vai trò |
|---|---|---|
| Seam | `seams/workspace.ts` | `ctx.workspace` — dataset/file theo session |
| Seam | `seams/sandbox.ts` | `ctx.sandbox` — quản lý process/container Python persistent + protocol event |
| Seam | `seams/prompt.ts` | `ctx.prompts` — ghép system prompt từ nhiều section có thứ tự |
| Seam | `seams/turn-memory.ts` | `ctx.turnMemory` — rolling summary theo session (tách khỏi `ctx.memory` lúc merge) |
| Seam (mở rộng) | `seams/tools.ts` | thêm `ToolInvocationContext` + `invoke()` — cổng execution chung TS↔Python |
| Provider | `bundles/providers/workspace-local` | file trên filesystem host/container hiện tại |
| Provider | `bundles/providers/workspace-docker` | file trên named volume Docker riêng từng session |
| Provider | `bundles/providers/sandbox-ipython` | spawn 1 process Python local, bridge LLM/tool/skill qua stdin/stdout |
| Provider | `bundles/providers/sandbox-docker` | biến thể: worker chạy trong 1 container riêng (kế thừa `sandbox-ipython`) |
| Provider | `bundles/providers/prompt-registry` | sort section theo `order`, ghép prompt, tạo version hash (sha256) |
| Provider | `bundles/providers/memory-rolling` | implement `ctx.turnMemory` — file JSON/session, tóm tắt semantic qua `ctx.llm` |
| Provider | `bundles/providers/skill-filesystem` | parse `SKILL.md`, discover resource, cấp `readResource()` |
| Loop driver | `bundles/loop-drivers/loop-rlm/index.ts` | orchestrate 1 turn RLM qua các seam trên |
| | `bundles/loop-drivers/loop-rlm/protocol.ts` | nơi DUY NHẤT dựng `PreparedRlmTurn` (contract gửi Python) |
| | `bundles/loop-drivers/loop-rlm/python/worker.py` | JSON-lines bridge — nhận lệnh, chạy `HarnessRLM`, phát event |
| Prompt | `bundles/prompts/prompt-rlm-data-agent/` | 6 section Markdown: identity, repl-protocol, turn-policy, evidence-policy, human-control, completion |
| Skills | `bundles/skills/<name>/SKILL.md` + `{assets,references,scripts,checklists,templates}/` | ~20 skill data-science (pandas, statistics, visualization, cohort/funnel/segmentation, ML...) |
| Python | `bundles/loop-drivers/loop-rlm/python/rlm_agent/` | `HarnessRLM` (adapter mỏng tới core RLM), context builder, policy, tools bridge |
| Python | `bundles/loop-drivers/loop-rlm/python/vendor/rlm/` | core RLM vendor nguyên bản, kèm `UPSTREAM.md`/`LICENSE` |
| Test | `tests/rlm-migration.test.ts`, `tests/rlm-worker-protocol.test.ts` | boundary TS↔Python, seam lifecycle |
| Benchmark | `benchmarks/rlm/` | regression case thật (DABench, multi-turn, skill, tool, memory, REPL) + `run.py` |

## 3. Flow 1 turn, từng bước thật

```
Client: POST /sessions {"driver":"rlm"} → adapter verify identity → ctx.sessions.create({ownerId, driver:'rlm'})

Client: POST /sessions/:id/messages {"message":..., "selectedSkill"?:...}
  → adapter (canAccessSession check) → ctx.agent.runTurn('rlm', session, {message, selectedSkill, metadata})
  → AgentRunner: chặn 2 turn đồng thời cùng session (Set activeSessions),
    ghi user_message vào ctx.storage, remember() vào ctx.memory (fire-and-forget),
    pin driver = ctx.loop.get('rlm')
  → loop-rlm.runTurn(runCtx, session, input):
      1. sandbox.openSession(sessionId, {cwd: workspace.root(sessionId)})
         — idempotent: nếu worker cho session này đã chạy, chỉ chờ ready
      2. prepareRlmTurn() [protocol.ts] — snapshot 1 lần, KHÔNG side-effect:
         ctx.turnMemory.snapshot(sessionId, {datasets, artifacts, contextIndex})
         + workspace.inspect(sessionId) (đọc content dataset context đầu tiên)
         + skills.get(selectedSkill) (nếu có, validate userInvocable)
         + tools.list() (metadata, không phải implementation)
         + prompts.render({driver:'rlm', sessionId}) → 1 prompt DUY NHẤT + version hash
         → gói thành PreparedRlmTurn { contractVersion:2, sessionId, request,
           contextIndex, historyIndex, pendingControl?, availableTools,
           prompt, promptVersion, context, metadata }
      3. sandbox.request(sessionId, 'prepared_turn', prepared)
         — ghi 1 dòng JSON vào stdin worker, trả AsyncIterable đọc stream JSON-lines từ stdout
      4. for await event of sandbox.request(...):
           - ghi storage.appendEvent(sessionId, {...event, source:'rlm'})
           - convert sang LoopStep (toStep()), emit('agent/step') cho WS/gRPC live
           - track steps (iteration_completed), finalContent (final_answer)
      5. Nhận '__result__' cuối stream → status/answer/memory/control/usage/trace_path
      6. Cập nhật Session.extension('loop:rlm') — contextIndex/historyIndex/pendingControl
         cho lượt SAU (state RLM riêng, không lẫn vào Session.history chung)
      7. Nếu turn không 'failed': ctx.turnMemory.completeTurn(sessionId, {state, request,
         outcome, trajectory, contexts, historyIndex}) — memory-rolling gọi ctx.llm
         tóm tắt semantic, ghi storage event 'memory_updated'
      8. status==='completed' → session.recordAssistant(content) (vào Session.history
         chung, dùng nếu sau này chuyển session sang driver khác)
      9. return LoopTurnResult {content, steps, status, control?, usage?, tracePath?}
```

**Bên trong worker.py** (mỗi khi core RLM cần thứ gì đó không tự có):

```
core RLM cần gọi model
  → HostLlmClient (implement BaseLM của core RLM, KHÔNG có key thật)
  → emit __host_llm__ (kèm messages/model/temperature/purpose/extra_body)
  → sandbox-ipython.completeHostCall(): await this.ctx.llm.complete(...) THẬT
  → gửi lại qua stdin: __host_llm_result__ {content, usage, model}
  → HostLlmClient trả completion cho core RLM, turn tiếp tục

core RLM (qua REPL) gọi 1 tool, vd. web_search(query=...)
  → emit __host_tool__ {name, args, sessionId, callId}
  → sandbox-ipython.completeToolCall(): await ctx.tools.invoke(name, args,
    {sessionId: state.sessionId (giá trị TS tin cậy, KHÔNG dùng event.sessionId
    worker tự báo — xem mục 6), source:'rlm'})
  → gửi lại __host_tool_result__ {callId, result}

core RLM cần đọc resource của skill đang chọn
  → emit __host_skill__ {skill, path, callId}
  → sandbox-ipython.completeSkillRead(): await ctx.skills.readResource(skill, path)
  → gửi lại __host_skill_result__ {callId, result: {content, encoding}}
```

## 4. Từng seam mới, chi tiết

### 4.1 `ctx.workspace` — dataset/file theo session

```ts
abstract class WorkspaceService extends Service {
  root(sessionId): string
  listDatasets(sessionId): WorkspaceDataset[]
  listArtifacts(sessionId): string[]
  inspect(sessionId): Promise<WorkspaceSnapshot>   // full content dataset — CHỈ dùng context đầu
  writeFile(sessionId, filename, content): Promise<{path, size}>
  readFile(sessionId, filePath): Promise<Buffer>
  listFiles(sessionId): Promise<Array<{path, size, mtime}>>
}
```

`workspace-local` (provider mặc định, đọc trực tiếp trong code): mỗi
session = 1 thư mục `data/workspaces/<sanitized-session-id>/`. File
tabular (`.csv/.tsv/.xlsx/.xls/.parquet`) tự đăng ký vào `index.json`
(id/filename/created_at) — đây chính là "dataset index" mà Python's
`load_dataset()` đọc, KHÔNG hardcode path. `generated/` là thư mục quy ước
cho output RLM tự tạo (`save_artifact()`), `listArtifacts()` chỉ quét đúng
thư mục đó. Chống path traversal 2 lớp: `root()` kiểm containment với
`basePath`, `writeFile`/`readFile` kiểm containment với chính `root`.

`workspace-docker`: cùng interface, nhưng file nằm trên named volume Docker
riêng từng session (dùng khi `RLM_SANDBOX_PROVIDER=docker` — mỗi session
1 container/volume cô lập, xem mục 7).

### 4.2 `ctx.sandbox` — process Python persistent

```ts
abstract class SandboxService extends Service {
  run(code, language): Promise<SandboxRunResult>        // 1-shot, không cần session
  openSession(sessionId, {cwd, metadata?}): Promise<void> // idempotent
  request(sessionId, operation, payload?): AsyncIterable<SandboxEvent>
  closeSession(sessionId): Promise<void>
}
```

`sandbox-ipython`: `Map<sessionId, WorkerState>` giữ 1 `child_process`
Python/session. `openSession()` spawn `python3 -u worker.py` với env
`RLM_RUNTIME_ROOT`/`RLM_AGENT_CONFIG_JSON`/`RLM_WORKSPACE_ROOT`, đợi event
`__ready__` đầu tiên. `request()` ghi 1 dòng JSON (`{requestId, operation,
payload}`) vào stdin, trả về 1 `EventQueue` (AsyncIterable tự viết, không
phụ thuộc thư viện ngoài) nhận event theo đúng `requestId` cho tới
`__done__`. `__host_llm__`/`__host_tool__`/`__host_skill__` là 3 loại event
ĐẶC BIỆT không gắn với 1 `requestId` đang chờ — được chặn riêng ngay trong
handler `'line'`, xử lý bằng `completeHostCall`/`completeToolCall`/
`completeSkillRead` (mục 3). stderr của worker CHỈ log (`redirect_stdout`
phía Python đảm bảo output thường của thư viện — pandas/numpy warning...
— không lẫn vào stdout, tránh phá vỡ giao thức JSON-lines).

`sessionId` là **key thật của TS** (đưa vào `WorkerState.sessionId` lúc
`openSession()`, sau khi adapter đã verify quyền sở hữu) — sửa lúc merge
để `completeToolCall()` dùng giá trị này thay vì tin `event.sessionId`
worker tự báo lại qua JSON (mục 6).

Cleanup thật: nghe `ctx.on('session/disposed', ...)` (event mới thêm ở
`session-registry`, phát khi session bị xoá/hết TTL/provider dispose) —
tự `closeSession()` (SIGTERM, chờ 2s, SIGKILL nếu cần) để không leak
process Python khi session hết hạn.

`sandbox-docker`: **kế thừa `SandboxIpython`**, chỉ đổi cách `launch`
process (chạy `docker run` thay vì `spawn` local) qua config hook
`launch`/`closeProcess` — toàn bộ logic bridge host-call ở mục 3 dùng
CHUNG, không viết lại.

### 4.3 `ctx.prompts` — ghép system prompt có version

```ts
abstract class PromptRegistryService extends Service {
  section(section: PromptSection): void   // {name, order, text: string | (ctx) => string}
  hasSection(name): boolean
  assemble(context?): PromptAssembly      // {sections: [{name, text}]}
  render(context?): RenderedPrompt        // {version: sha256(content).slice(0,12), content}
}
```

Mỗi tool plugin (`tool-database-query`, `tool-web-search`) TỰ đăng ký
section hướng dẫn riêng (`order: 115`) — không hardcode danh sách tool vào
Markdown tĩnh. `bundles/prompts/prompt-rlm-data-agent/` đăng ký 6 section
core (identity/repl-protocol/turn-policy/evidence-policy/human-control/
completion), đọc trực tiếp từ file `.md` trong `sections/`. `render()`
join tất cả section (đã sort theo `order`) bằng `\n\n`, hash sha256 12 ký
tự đầu làm `promptVersion` — đủ để trace CHÍNH XÁC bản prompt nào đã gửi
cho 1 turn cụ thể (so sánh/benchmark).

### 4.4 `ctx.turnMemory` — rolling summary theo session (seam MỚI TÁCH RA LÚC MERGE)

```ts
abstract class TurnMemoryService extends Service {
  snapshot(sessionId, {activeDatasets?, artifacts?, currentContextIndex?}): Promise<RollingMemorySnapshot>
  summary(sessionId): Promise<string>
  sourceContexts(sessionId, currentContextIndex?): Promise<string[]>
  recordContext(sessionId, contextIndex): Promise<void>
  recordTurn(sessionId, input: RollingTurnInput): Promise<Record<string,unknown>>
  completeTurn(sessionId, input: CompleteTurnInput): Promise<CompleteTurnResult>
  clear(sessionId): Promise<void>
}
```

**KHÁC `ctx.memory`** (remember/recall xuyên session/user qua TencentDB
Agent Memory, Phase 25) — đây là summary THEO TỪNG SESSION, mục đích DUY
NHẤT là nén `Session.history` dài thành 1 đoạn ngắn để nhét vào
`PreparedRlmTurn` mỗi lượt (không phải tra cứu ngữ nghĩa xuyên session).
Nhánh RLM gốc gộp cả 2 vào chung `ctx.memory` — lúc merge đã tách seam
riêng vì 2 capability không liên quan, ép chung 1 interface sẽ buộc
`memory-tencentdb` phải tự chế 6 method rolling-specific mà nó không có dữ
liệu để trả đúng nghĩa (xem `docs/agent-core-rlm-harness-merge-plan.md`
mục 4.1 cho phân tích đầy đủ).

`memory-rolling` (provider duy nhất hiện có): file JSON 1/session tại
`data/rlm-memory/<sessionId>.json` (`version/revision/summary/turns/
lastContext/pending`), ghi an toàn qua write-temp-rồi-rename. `completeTurn()`
gọi `ctx.llm.complete()` với 1 system prompt cố định yêu cầu model trả về
đúng 1 JSON `{summary, turn_summary}` — summary là bản THAY THẾ HOÀN TOÀN
(không phải delta cộng dồn). Có fallback deterministic (ghép
`Request:...\nOutcome:...` thô) nếu LLM lỗi hoặc trả JSON không hợp lệ —
KHÔNG BAO GIỜ để turn thất bại chỉ vì summarization lỗi.

## 5. Skill: package trên filesystem, đọc lazy

`skill-filesystem` quét `bundles/skills/<name>/SKILL.md` (frontmatter
`name/description/triggers/user-invocable`), tự nhận diện resource trong 5
thư mục con quy ước (`assets/references/checklists/scripts/templates`) —
đăng ký METADATA (path + kind) chứ KHÔNG đọc content ngay. Nội dung resource
chỉ đọc thật khi RLM chủ động gọi `skill_resource(path)` trong REPL (bridge
`__host_skill__` → `ctx.skills.readResource()` → provider đọc file, có
containment check chống path traversal). Cách này giữ context nhẹ — 1 skill
lớn (vd. `data-scientist/`, 174 dòng SKILL.md + hơn chục file reference/
script/template) không bị nạp hết vào prompt, chỉ phần thật sự cần.

`SKILL.md` (entrypoint, luôn nạp vào `PreparedRlmTurn.context.selected_skill`
khi user chọn) khác `references/`/`scripts/`/... (resource, đọc lazy) —
nguyên tắc "không thêm registry Python thứ hai" giữ đúng: `skill_registry.py`
phía Python (nếu còn) chỉ là compatibility code, không sở hữu catalog thật.

## 6. An toàn/ownership áp dụng cho các cấu phần mới (đã fix lúc merge)

- **`ToolInvocationContext`** (`sessionId`, `source: 'default-loop'|
  'planner-critic'|'rlm'|'subagent'`) giờ THẬT SỰ truyền xuống
  `ToolHandler` (bản gốc RLM định nghĩa field này nhưng
  `tool-registry.invoke()` bỏ luôn, không truyền — sửa lúc merge).
  `tool-database-query` dùng `context.sessionId` (session THẬT của turn),
  không còn tin `args.sessionId` model tự cho — đóng lỗ hổng đọc transcript
  session bất kỳ (Finding A1,
  `docs/agent-core-rate-limit-and-security-audit.md`).
- **`sandbox-ipython.completeToolCall()`** dùng `state.sessionId` (giá trị
  TS đã verify từ lúc `openSession()`), không dùng `event.sessionId`
  (Python worker tự báo lại qua JSON — không đáng tin cho quyết định
  authz, dù chỉ Python CỦA CHÍNH session đó mới gửi được event này qua
  đúng stdin của nó).
- **`GET/POST /sessions/:id/files`** (workspace file — dataset/output thật)
  thêm `canAccessSession()` — bản merge sạch từ RLM ban đầu KHÔNG có check
  này, khác `/messages`/`/events` đã có sẵn. 2 test 403 mới khoá hành vi.

## 7. Deployment

`Dockerfile`: stage `rlm-python` (`python:3.11-slim-bookworm`, cài `torch`
CPU wheel + `bundles/loop-drivers/loop-rlm/python/requirements.txt`) build
tách biệt, rồi
`COPY --from=rlm-python /usr/local /usr/local` vào stage `runtime` (Node
22 slim) — 1 image DUY NHẤT chứa cả 2 runtime, không cần sibling repo hay
image `data-agent` build sẵn. Cần đủ bộ thư viện hệ thống
(`libsqlite3-0`/`libreadline8`/`libgdbm6`/`libssl3`/`libtcl8.6`/... — runtime
dependency THẬT của chính interpreter Python cho numpy/pandas/scipy/
matplotlib/ipykernel, xem `docs/agent-core-rlm-harness-merge-plan.md` mục
8.3 cho gap thật đã gặp khi thiếu chúng). User `agent` chạy KHÔNG sudo
(khác `Dockerfile.dev`, biến thể riêng cho dev container có sudo + OpenCode
CLI, không dùng cho production).

`docker-compose.yml`: `agent-core` container chạy CẢ TypeScript lẫn Python
worker (mặc định `RLM_SANDBOX_PROVIDER=local`, không cần Docker socket).
Chọn `RLM_SANDBOX_PROVIDER=docker` thì mỗi session dùng 1 container/volume
riêng (cách ly mạnh hơn, cần mount Docker socket + `RLM_DOCKER_IMAGE`).

Env chính (`optionalNumber`/`optionalBoolean` pattern giống mọi provider
khác trong `src/serve.ts`): `RLM_RUNTIME_ROOT`, `RLM_WORKSPACE_BASE`,
`RLM_PYTHON_BIN`, `RLM_SANDBOX_PROVIDER`, `RLM_MAX_ITERATIONS`,
`RLM_MAX_DEPTH`, `RLM_CELL_TIMEOUT`, `RLM_MODEL_CONTEXT_TOKENS`,
`RLM_MEMORY_PATH`, `RLM_SKILLS_ROOT`.

## 8. Test & benchmark

- `tests/rlm-migration.test.ts` (8 test) — hợp đồng `PreparedRlmTurn` (đúng
  field, không lộ `<session_memory>`/`<host_tools>` thô vào prompt), lifecycle
  `ctx.turnMemory` qua seam thật (không mock), bridge tool/skill/LLM
  giả lập worker qua stdin/stdout thật (không mock module Python).
- `tests/rlm-worker-protocol.test.ts` — hình dạng JSON-lines cơ bản.
- `benchmarks/rlm/` — case thật (không phải unit test): DABench (câu hỏi
  phân tích dữ liệu chuẩn học thuật), multi-turn, memory, skill, tool,
  REPL — kèm fixture CSV thật (`fixtures/dabench/`, `fixtures/synth/`) và
  `run.py` để chạy regression, không tự động trong CI (không có trong
  `npm test`).

## 9. Giới hạn hiện tại (trung thực, chưa fix)

- `sandbox-ipython`/`sandbox-docker` cô lập process/filesystem/network cơ
  bản, CHƯA phải sandbox chống adversarial container escape — production
  public cần hardening/remote sandbox riêng theo threat model thật.
- Finding A2 (`docs/agent-core-rate-limit-and-security-audit.md`) — session
  storage (SQLite) vẫn chưa có khái niệm chủ sở hữu ở tầng lưu trữ, kết
  hợp việc client vẫn tự chọn được session id → nguy cơ "nhận lại" session
  id đã hết TTL của người khác — KHÔNG liên quan trực tiếp tới RLM nhưng
  cùng áp dụng cho workspace/turnMemory theo sessionId.
- Rate-limiting (`ctx.ratelimit`, cùng doc trên) vẫn ở mức plan, chưa
  implement — 1 turn RLM có thể chạy nhiều iteration/subcall tốn kém, chưa
  có giới hạn tần suất riêng cho endpoint `/sessions/:id/messages` khi
  `driver:"rlm"`.
