# Agent Core: kiến trúc hệ thống và bản đồ code

Tài liệu này dành cho người mới vào dự án, đặc biệt là người không quen
TypeScript. Mục tiêu là trả lời bốn câu hỏi:

1. Hệ thống hiện tại làm gì?
2. Một request đi qua những thành phần nào?
3. Mỗi folder/file quan trọng chịu trách nhiệm gì?
4. Muốn sửa hoặc mở rộng một chức năng thì phải chạm đúng chỗ nào?

Contract dành riêng cho frontend nằm tại
[`frontend-backend-handoff.md`](frontend-backend-handoff.md). Tài liệu này mô tả
kiến trúc nội bộ của backend và quan hệ giữa TypeScript harness với Python RLM.

## 1. Mô hình ngắn nhất

`agent-core` là **harness/orchestrator**. Nó không phải một agent duy nhất.
Nó lắp các capability độc lập thành một application bằng plugin:

```text
Client
  │ REST / WebSocket / gRPC
  ▼
Adapters ── auth ── sessions
  │
  ▼
AgentRunner ── chọn LoopDriver
  │
  ├─ default loop ── LLM + tools + skills
  │
  └─ RLM loop ── prompt + memory + workspace + sandbox
                                   │
                                   ▼
                            Python worker
                                   │
                                   ▼
                        HarnessRLM / core RLM
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              host LLM bridge  host tools   skill resources
                    │              │              │
                    └──────── TypeScript ctx ─────┘
```

Ý chính:

- TypeScript sở hữu session, auth, storage, prompt, memory, tools, skills,
  workspace và transport API.
- Python sở hữu execution loop gắn chặt với core RLM: persistent REPL,
  iterations, subcalls, context compaction và trajectory.
- Python không giữ API key và không tự implement lại tool/skill/memory của
  harness. Khi cần, worker gọi ngược về capability trên TypeScript.
- UI là một client của contract REST/WebSocket; UI không sở hữu system prompt
  hay logic agent.

## 2. Tư tưởng “everything is a plugin”

Hệ thống chia code thành ba loại chính.

### 2.1 Seam: hệ thống cần khả năng gì?

`seams/*.ts` chỉ định nghĩa contract. Ví dụ `WorkspaceService` nói hệ thống
cần các hàm `writeFile`, `readFile`, `listFiles`, nhưng không quyết định file
nằm trên host hay Docker volume.

Seam tương đương một abstract base class trong Python:

```python
from abc import ABC, abstractmethod

class WorkspaceService(ABC):
    @abstractmethod
    def list_files(self, session_id: str): ...
```

### 2.2 Provider: thực thi seam bằng cách nào?

`bundles/providers/*` chứa implementation. Ví dụ:

- `workspace-local`: file nằm trong thư mục host/container hiện tại.
- `workspace-docker`: file nằm trong named volume Docker.
- Cả hai cùng implement `WorkspaceService`, nên loop chỉ gọi
  `ctx.workspace`; loop không cần biết provider nào đang được dùng.

### 2.3 Feature plugin: đăng ký thêm cái gì?

Tool, skill, prompt section và loop driver cũng là plugin. Khi plugin được
mount, nó đăng ký feature vào registry tương ứng; khi plugin bị dispose,
Cordis effect scope gỡ feature đó ra.

Python gần tương đương:

```python
def apply(ctx):
    ctx.tools.add(web_search_definition)
```

### 2.4 `ctx`, `inject`, `apply` thực sự nghĩa là gì?

Ví dụ TypeScript:

```ts
export const inject = ['llm', 'storage', 'tools', 'loop', 'skills']

export const apply = async (ctx: Context) => {
  await ctx.plugin(AgentRunner)
}
```

- `ctx` là Cordis dependency container của application.
- `ctx.llm`, `ctx.tools`, `ctx.loop`... xuất hiện khi provider tương ứng đã
  đăng ký service vào context.
- `inject` khai báo dependency của plugin. Cordis chỉ activate plugin khi các
  service này tồn tại; dependency biến mất thì plugin bị suspend theo lifecycle.
- `apply` là entrypoint lúc plugin được mount.
- `ctx.plugin(...)` mount thêm một service/plugin con.

`this.ctx.loop.get(name)` trong `AgentRunner` có nghĩa là: lấy loop registry
từ context mà Cordis truyền cho service, rồi tìm driver đã đăng ký dưới tên
`name`. `ctx` không tự chứa loop từ đầu; `loop-registry` tạo `ctx.loop` trong
composition root `src/serve.ts`.

## 3. Composition root: hệ thống được lắp ở đâu?

File quan trọng nhất là `src/serve.ts`. Đây là nơi duy nhất quyết định bản
deploy hiện tại dùng provider nào.

Trình tự mount chính:

```text
1.  tool-registry
2.  state-sqlite
3.  permission-rbac
4.  llm-qwen
5.  subagent-manager
6.  skill-registry + skill plugins/filesystem
7.  prompt-registry + RLM prompt sections
8.  memory-rolling
9.  workspace-local hoặc workspace-docker
10. loop-registry + loop-default + loop-rlm
11. agent-runner
12. session-registry
13. sandbox-ipython hoặc sandbox-docker
14. auth-apikey
15. tool plugins
16. REST + WebSocket + gRPC + Web UI adapters
```

Thứ tự quan trọng vì plugin chỉ hoạt động khi dependency trong `inject` đã có.
Muốn đổi implementation, sửa composition tại đây; consumer không cần sửa.

Ví dụ đổi LLM provider:

```text
llm-qwen  ──implements──> seams/llm.ts
llm-deepseek ─implements─> seams/llm.ts
```

Chỉ mount một provider tương ứng trong `serve.ts`; `AgentRunner`, loop và tool
vẫn gọi cùng `ctx.llm.complete()`.

## 4. Flow của một request

### 4.1 Tạo session

```text
Client
  → POST /sessions hoặc WS create_session
  → adapter kiểm tra ctx.auth
  → ctx.sessions.create({ driver: "rlm", maxSteps })
  → SessionRegistry tạo Session domain object trong RAM
  → trả sessionId cho client
```

`Session` giữ history ngắn hạn và extension state của loop. Nó không phải
memory dài hạn và không phải SQLite event history.

### 4.2 Upload dataset

```text
Browser chọn file
  → POST /sessions/:id/files (raw binary)
  → api-rest kiểm tra auth + session + giới hạn payload
  → ctx.workspace.writeFile(sessionId, filename, bytes)
  → provider lưu file
  → nếu là CSV/TSV/XLSX/Parquet, cập nhật index.json
  → GET /sessions/:id/files trả Dataset / Output / File cho UI
```

Mọi đường dẫn đều được resolve bên trong workspace của session để chống path
escape. Output RLM nên ghi vào `generated/`; frontend phân loại các file này
là **Output**.

### 4.3 Gửi một RLM turn

```text
Client send_message
  → API adapter xác thực
  → ctx.sessions.get(sessionId)
  → ctx.agent.runTurn("rlm", session, input)
  → AgentRunner chống hai turn đồng thời trên cùng session
  → lưu user_message vào ctx.storage
  → pin driver = ctx.loop.get("rlm")
  → driver.runTurn(stableCtx, session, input)
```

`AgentRunner` là high-level runner dùng chung cho mọi transport. Adapter không
gọi RLM trực tiếp và không tự quản lý memory.

### 4.4 Chuẩn bị `PreparedRlmTurn`

`loop-rlm/protocol.ts` đọc đúng một snapshot từ các seam:

```text
ctx.memory.snapshot(sessionId)
ctx.workspace.inspect(sessionId)
ctx.skills.get(selectedSkill)
ctx.tools.list()
ctx.prompts.render({ driver: "rlm" })
            │
            ▼
PreparedRlmTurn contractVersion=2
```

Payload gồm:

- request hiện tại;
- context index/history index;
- memory summary và resource manifest;
- dataset content ở context đầu tiên;
- selected skill nếu có;
- metadata của tools;
- đúng **một** system prompt đã render và prompt version hash.

Runtime state nằm trong `context_N`, không được copy vào system prompt. Nhờ đó
system prompt ổn định, dễ version/benchmark và ít bị instruction collision.

### 4.5 TypeScript ↔ Python worker

`sandbox-ipython` mở một process Python persistent cho mỗi session:

```text
TypeScript stdin  ── JSON line command ──> worker.py
TypeScript stdout <─ JSON line event  ─── worker.py
Python logs       ── stderr, không trộn vào protocol
```

Mỗi command có `requestId`. Worker stream `analysis`, `code`, `observation`,
`tool_call`, `final_answer`... rồi kết thúc bằng `__result__`/`__done__`.
Sandbox provider đổi event Python thành `AsyncIterable`; `loop-rlm` đổi chúng
thành `LoopStep`, lưu event và phát live event `agent/step` cho WS/gRPC.

### 4.6 Model call bridge

Core RLM tưởng rằng nó đang gọi một Python `BaseLM`, nhưng `HostLlmClient`
trong `worker.py` phát event `__host_llm__` về TypeScript:

```text
core RLM
  → HostLlmClient
  → __host_llm__
  → sandbox-ipython.completeHostCall()
  → ctx.llm.complete()
  → response quay lại worker
```

API key chỉ nằm ở TypeScript provider. Python worker không cần biết endpoint
hoặc secret thật.

### 4.7 Tool bridge

RLM chạy code trong REPL nhưng tool thật thuộc harness:

```text
Python gọi web_search({...})
  → worker phát __host_tool__
  → sandbox gọi ctx.tools.invoke(name, args, { sessionId, source: "rlm" })
  → ToolRegistry tìm plugin tool
  → permission/tool handler chạy ở TypeScript
  → kết quả trả về Python REPL
```

Nhờ vậy không copy implementation tool vào REPL. Default loop, RLM loop và
subagent đều dùng cùng registry, permission và lifecycle.

### 4.8 Skill bridge

Selected skill được đưa vào prepared context. `SKILL.md` là hướng dẫn chính;
asset/reference/script chỉ được đọc lazy khi RLM gọi `skill_resource(...)`:

```text
worker __host_skill__
  → ctx.skills.readResource(skillName, path)
  → skill-filesystem đọc resource trong đúng package
```

Skill không phải tool và không tự chạy. Nó thay đổi cách model giải quyết task;
tool là một action có handler thực thi.

### 4.9 Kết thúc turn và memory

```text
worker trả outcome + trajectory + state
  → loop-rlm cập nhật context/history index
  → ctx.memory.completeTurn(...)
  → memory-rolling dùng ctx.llm để tạo semantic summary
  → fallback deterministic nếu summarization lỗi
  → lưu memory JSON giới hạn theo session
  → trả LoopTurnResult cho adapter
```

Memory thuộc TypeScript. Python chỉ trả dữ liệu cần thiết để provider cập nhật.
Nếu status là `waiting_user` hoặc `waiting_approval`, session giữ pending
control; turn sau được đóng gói thành `human_response`.

## 5. State nằm ở đâu?

| State | Owner | Nơi lưu | Sống qua restart? |
|---|---|---|---|
| Session object + loop extension | `session-registry` | RAM | Không |
| Event/audit history | `state-sqlite` | `data/sessions.db` | Có nếu volume còn |
| Semantic rolling memory | `memory-rolling` | `data/rlm-memory/*.json` | Có nếu volume còn |
| Dataset/output | workspace provider | `data/rlm-workspaces/<sessionId>` hoặc Docker volume | Tuỳ provider/volume |
| Python REPL/kernel | sandbox provider | process/container theo session | Không |
| Prompt sections | prompt plugins | source Markdown, render trong RAM | Source có; registry rebuild lúc boot |
| Browser session list | frontend | `localStorage` | Có trong browser |

Điểm dễ nhầm: SQLite events, `Session.history` và rolling memory là ba thứ
khác nhau. Event là audit log; history là context ngắn của loop thường; memory
là summary bền hơn dành cho multi-turn RLM.

## 6. Bản đồ file và tác dụng

### 6.1 Root

| File | Tác dụng | Sửa khi nào? |
|---|---|---|
| `package.json` | Scripts, dependencies và npm workspaces | Thêm package/dependency/script |
| `.env.example` | Contract cấu hình, không chứa secret thật | Thêm/đổi env var |
| `Dockerfile` | Build image runtime, UI và copy Python dependencies | Đổi production image/runtime |
| `Dockerfile.dev` | Image development có source mount + watch | Đổi môi trường dev |
| `docker-compose.yml` | Service/port/volume/env nền | Đổi deployment mặc định |
| `docker-compose.dev.yml` | Override live mount/hot reload | Đổi workflow dev |
| `docker-compose.prod.yml` | Override dự kiến cho production-like | Không coi là image standalone khi Python source còn ở sibling repo |
| `README.md` | Quick start và giới hạn tổng quát | Thay đổi cách chạy chính |
| `tsconfig.json` | Luật typecheck TypeScript | Đổi compiler/module settings |

Lưu ý hiện trạng: Compose base mount thư mục cha vào
`/workspace/Triadic_DGM` để worker import sibling `data-agent`. Do cách Compose
merge danh sách volume, file `docker-compose.prod.yml` hiện chưa loại bỏ hoàn
toàn các bind mount của file base. Vì vậy nó là production-like, chưa phải
artifact production standalone.

### 6.2 `src/`

| File | Tác dụng |
|---|---|
| `src/serve.ts` | Composition root, đọc env, mount toàn bộ plugin, mở server, shutdown |
| `src/env.ts` | Parse/repair JSON env như `OPENAI_EXTRA_BODY` |
| `src/sanity-check.ts` | Composition nhỏ để kiểm tra lifecycle/plugin architecture |

Nếu cần biết “`ctx.X` được load ở đâu”, tìm `root.plugin(...)` trong
`src/serve.ts`, rồi mở provider tương ứng.

### 6.3 `seams/`: contract ổn định

| File | Capability trên `ctx` |
|---|---|
| `agent.ts` | `ctx.agent`: entrypoint chạy một turn |
| `auth.ts` | `ctx.auth`: xác thực token |
| `llm.ts` | `ctx.llm`: model completion |
| `loop.ts` | `ctx.loop`, `Session`, `TurnInput`, `LoopStep`, `LoopTurnResult` |
| `memory.ts` | `ctx.memory`: snapshot/update memory |
| `permission.ts` | `ctx.permission`: policy check |
| `prompt.ts` | `ctx.prompts`: đăng ký section và render prompt |
| `sandbox.ts` | `ctx.sandbox`: runtime persistent + event protocol |
| `sessions.ts` | `ctx.sessions`: registry session dùng chung transport |
| `skill.ts` | `ctx.skills`: catalog và lazy resource reader |
| `storage.ts` | `ctx.storage`: append/read event |
| `subagents.ts` | `ctx.subagents`: registry task delegation |
| `tools.ts` | `ctx.tools`: catalog và execution gateway duy nhất |
| `workspace.ts` | `ctx.workspace`: dataset/artifact/file operations |

Quy tắc: seam không import provider và không chứa logic deployment.

### 6.4 `bundles/providers/`: implementation capability

| Folder | Vai trò |
|---|---|
| `agent-runner` | Chống concurrent turn, lưu user event, pin loop driver |
| `auth-apikey` | So token với danh sách `API_KEYS` |
| `llm-qwen` | OpenAI-compatible Qwen client, timeout/retry/usage |
| `llm-deepseek` | Provider LLM thay thế |
| `loop-registry` | Map tên driver → implementation |
| `memory-rolling` | Memory JSON có giới hạn + semantic summarization |
| `permission-rbac` | Permission deny-by-default theo actor/action |
| `prompt-registry` | Sort section theo order, ghép prompt, tạo version hash |
| `sandbox-ipython` | Spawn worker Python local và bridge LLM/tool/skill |
| `sandbox-docker` | Biến thể chạy worker trong container riêng |
| `session-registry` | Session RAM, sliding TTL và lifecycle events |
| `skill-filesystem` | Parse `SKILL.md`, discover/read package resources |
| `skill-registry` | Catalog skill trong RAM |
| `state-sqlite` | Event store SQLite và retention sweep |
| `subagent-manager` | Catalog subagent |
| `tool-registry` | Catalog + execution gateway cho tool |
| `workspace-local` | Workspace bằng filesystem local |
| `workspace-docker` | Workspace bằng Docker named volume |

### 6.5 `bundles/loop-drivers/`

| File/folder | Vai trò |
|---|---|
| `loop-default/index.ts` | Loop tool-calling đơn giản dùng LLM trực tiếp |
| `loop-planner-critic/index.ts` | Driver thay thế minh hoạ hot-swap |
| `loop-rlm/index.ts` | Orchestrate một RLM turn qua framework seams |
| `loop-rlm/protocol.ts` | Nơi duy nhất dựng `PreparedRlmTurn` contract |
| `loop-rlm/python/worker.py` | JSON-lines bridge giữa TS và `HarnessRLM` |

Không đưa logic REST/UI vào loop. Không để worker tự đọc database/memory/tool
catalog của TypeScript.

### 6.6 Prompt

| File | Vai trò |
|---|---|
| `bundles/prompts/prompt-rlm-data-agent/index.ts` | Đăng ký các Markdown section |
| `sections/identity.md` | Agent là ai/phạm vi gì |
| `sections/repl-protocol.md` | Cách phát code và dùng REPL |
| `sections/turn-policy.md` | Cách xử lý từng loại turn/context |
| `sections/evidence-policy.md` | Luật dữ liệu/evidence, tránh kết luận không kiểm chứng |
| `sections/human-control.md` | Khi nào hỏi user/chờ approval |
| `sections/completion.md` | Điều kiện hoàn thành và final output |

Tool plugin tự đăng ký hướng dẫn tool vào prompt registry. Không hardcode danh
sách tool/skill/memory động vào Markdown system prompt.

### 6.7 Tools, skills và subagents

| Folder | Vai trò |
|---|---|
| `bundles/tools/tool-web-search` | `web_search`, permission + timeout + UI metadata |
| `bundles/tools/tool-database-query` | Query event database qua storage abstraction |
| `bundles/skills/<name>/SKILL.md` | Hướng dẫn top-level của skill |
| `bundles/skills/<name>/{assets,references,scripts,...}` | Resource đọc lazy, không phải skill con |
| `bundles/skills/skill-support-tone` | Ví dụ skill plugin viết trực tiếp bằng TS |
| `bundles/subagents/subagent-report-writer` | Ví dụ subagent độc lập dùng permission + LLM |

Nhóm skill dữ liệu hiện có: explore/validate data, data scientist, pandas,
statistics, visualization, SQL insights, feature engineering, model evaluation,
scikit-learn, cohort/funnel/segmentation/time-series và data-quality audit.

### 6.8 Adapters

| Folder | Vai trò |
|---|---|
| `api-rest` | REST health/session/message/events/skills/workspace files |
| `api-ws` | Create session, send message và live `LoopStep` stream |
| `api-grpc` | Unary + server-streaming cho non-browser clients |
| `api-grpc/agent.proto` | Schema gRPC |
| `web-ui` | Serve static React build tại port UI |

Adapter chỉ chuyển transport ↔ domain call. Business logic phải nằm sau seam,
không được fork riêng theo REST/WS/gRPC.

### 6.9 Frontend và UI packages

| File/folder | Vai trò |
|---|---|
| `apps/web/src/App.tsx` | Shell chat, WS flow, upload progress, workspace panel |
| `AssistantMarkdown.tsx` | Render final answer Markdown an toàn |
| `Sidebar.tsx` | Danh sách/resume session phía browser |
| `GenericToolCard.tsx`, `ToolRow.tsx` | Render tool event theo `toolUi` metadata |
| `settings.ts` | REST/WS URL và API key browser settings |
| `sessionHistory.ts` | Serialize/restore browser history |
| `sidebarState.ts` | Sidebar presentation state |
| `packages/ui-slots` | Registry/contract cho UI extension slots |
| `packages/ui-react` | React adapter/error boundary cho slots |
| `packages/ui-tool-web-search` | Specialized web-search card plugin |
| `packages/ui-primitives` | Button/modal/pill/toast/tooltip dùng chung |
| `packages/ui-theme` | Design tokens CSS |

Frontend mới có thể bỏ reference UI và viết lại hoàn toàn, miễn giữ contract
trong `frontend-backend-handoff.md`.

### 6.10 Test và benchmark

| Folder | Vai trò |
|---|---|
| `tests/` | Unit/integration test seams, lifecycle, adapters và RLM protocol |
| `apps/web/tests/` | UI behavior/smoke tests |
| `packages/*/tests/` | Test UI plugin infrastructure |
| `benchmarks/rlm/` | Behavioral regression cases, runner và fixtures |
| `reports/` | Output benchmark sinh ra; bị gitignore, không phải source |

Các test nên đọc đầu tiên:

- `tests/spatial-composability.test.ts`: hiểu plugin dependency/lifecycle.
- `tests/agent-loop.test.ts`: hiểu default request flow.
- `tests/rlm-migration.test.ts`: hiểu boundary TS ↔ Python.
- `tests/api-rest.test.ts`, `tests/api-ws.test.ts`: hiểu transport contract.

## 7. Repo `data-agent` còn làm gì?

Worker hiện import:

```text
data-agent/triadic_dgm/rlm_agent/harness_adapter.py
data-agent/vendor/rlm/...
```

`HarnessRLM` là adapter mỏng tới core RLM. Nó nhận prepared context và các
callback bridge từ harness. Những phần gắn trực tiếp với core RLM/REPL chưa có
extension point vẫn nằm ở Python; orchestration cấp application đã chuyển sang
TypeScript.

Do đó:

- Push `agent-core` không tự mang theo thay đổi Python của `data-agent`.
- Người chỉ viết frontend có thể dùng backend đã deploy, không cần clone Python.
- Người tự build/chạy backend cần sibling `data-agent` đúng version và image
  `data-agent-backend:latest`.
- Mục tiêu dài hạn có thể thay tiếp Python internals bằng framework plugin,
  nhưng không được tạo duplicate registry/memory/workspace trong worker.

## 8. Muốn mở rộng thì sửa đâu?

### Thêm tool

1. Tạo `bundles/tools/tool-<name>/index.ts`.
2. Khai `inject = ['tools', ...dependency]`.
3. Trong `apply`, gọi `ctx.tools.add(...)`.
4. Tool tự đăng ký prompt guidance nếu model cần biết cách dùng.
5. Mount plugin trong `src/serve.ts`.
6. Thêm test permission, timeout, output shape.

Kết quả: cả default loop và RLM đều thấy tool; không sửa `worker.py` cho từng
tool mới.

### Thêm skill

1. Tạo `bundles/skills/<name>/SKILL.md`.
2. Thêm resource trong `references/`, `scripts/`, `assets/` nếu cần.
3. `skill-filesystem` tự discover package lúc boot.

Không thêm registry Python thứ hai và không biến resource thành tool giả.

### Đổi system prompt

Sửa/thêm section Markdown và đăng ký section với `name/order`. Không sửa UI,
không gửi system prompt từ request, không dựng prompt trong `worker.py`.

### Thêm loop mới

1. Implement `LoopDriver`.
2. Plugin gọi `ctx.loop.register('new-name', driver)`.
3. Session/client chọn `driver: 'new-name'`.

AgentRunner và adapters giữ nguyên.

### Thay memory/workspace/sandbox

Implement abstract service trong seam tương ứng và đổi provider được mount ở
`src/serve.ts`. Không bọc thêm một high-level wrapper quanh `AgentRunner`.

## 9. Cách đọc TypeScript trong repo này bằng tư duy Python

| TypeScript | Python gần tương đương |
|---|---|
| `interface X { ... }` | `Protocol`/type contract |
| `abstract class X extends Service` | `class X(ABC)` |
| `export` | symbol public từ module |
| `import * as plugin from ...` | `import module as plugin` |
| `await ctx.plugin(plugin)` | `await app.install(plugin)` |
| `this.ctx.tools` | `self.ctx.tools` |
| `foo?: string` | `foo: str | None` |
| `Record<string, unknown>` | `dict[str, Any]` |
| `Promise<T>` | awaitable trả về `T` |
| `AsyncIterable<T>` | async generator |
| `declare module ... Context` | bổ sung type cho `ctx.<service>` |

Khi đọc một flow, không cần hiểu toàn bộ cú pháp TS. Theo thứ tự:

```text
adapter endpoint
  → ctx.agent.runTurn
  → AgentRunner
  → ctx.loop.get(driver)
  → loop driver
  → seam calls
  → provider implementations
```

## 10. Chạy và kiểm tra

```bash
cd /home/phunq/5080_cuda13/Triadic_DGM/data-agent
docker compose build backend

cd ../agent-core
cp .env.example .env
# điền OPENAI_* và API_KEYS
docker compose up -d --build
```

Endpoints mặc định:

| Service | Address |
|---|---|
| REST | `http://localhost:8787` |
| WebSocket | `ws://localhost:8788` |
| Web UI | `http://localhost:8790` |
| gRPC | `localhost:15052` trên host → `50051` container |

Kiểm tra code:

```bash
npm run typecheck
npm run build:web
npm test
```

## 11. Thứ tự đọc khuyến nghị

Nếu chỉ có 30 phút:

1. `docs/system-architecture.md` — tài liệu này.
2. `src/serve.ts` — application được lắp thế nào.
3. `seams/loop.ts` và `seams/agent.ts` — domain turn.
4. `bundles/providers/agent-runner/index.ts` — high-level request runner.
5. `bundles/loop-drivers/loop-rlm/index.ts` — RLM orchestration.
6. `bundles/loop-drivers/loop-rlm/protocol.ts` — input contract sang Python.
7. `bundles/providers/sandbox-ipython/index.ts` — process bridge.
8. `bundles/loop-drivers/loop-rlm/python/worker.py` — Python side.
9. `docs/frontend-backend-handoff.md` — public API/UI contract.

Frontend team chỉ cần đọc mục 1, 4, 5, 6.8, 6.9 và tài liệu handoff. Backend
team nên đọc toàn bộ flow 4 cùng các seam/provider liên quan trước khi sửa.

## 12. Nguyên tắc không được phá

- Một capability có một seam và một provider active; không dựng registry song
  song trong Python/UI.
- Adapter không sở hữu business logic.
- Frontend không gửi system prompt mặc định.
- Tool execution luôn qua `ctx.tools.invoke()` và permission phù hợp.
- File của session luôn qua `ctx.workspace`, không tự ghép path rải rác.
- Memory dài hạn thuộc `ctx.memory`; event audit thuộc `ctx.storage`.
- Mỗi session chỉ có một turn in-flight.
- Worker stdout chỉ chứa JSON-lines protocol; log đi stderr.
- `PreparedRlmTurn` chỉ được dựng ở `loop-rlm/protocol.ts`.
- Thay implementation bằng provider/plugin, không chồng thêm wrapper ở tầng
  ngoài `AgentRunner`.
