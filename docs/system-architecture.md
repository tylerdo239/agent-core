# Agent Core: kiến trúc hệ thống và bản đồ code

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
Adapters ── auth ── projects ── sessions
  │
  ▼
AgentRunner ── chọn LoopDriver
  │
  ├─ default loop ── LLM + tools + skills + context compactor
  │
  └─ RLM loop ── skill gate + prompt + memory + workspace + sandbox
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
7.  prompt-registry + default/RLM prompt sections
8.  memory-rolling
9.  workspace-local hoặc workspace-docker
10. artifact-service + job-runner + pipeline-registry
11. loop-registry + loop-default + loop-rlm
12. agent-runner + session-registry
13. sandbox-ipython hoặc sandbox-docker
14. pipeline stages + pipeline-runner
15. auth-apikey + tool plugins
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

### 4.1 Tạo project và session

```text
RLM UI
  → POST /projects
  → POST /projects/:projectId/sessions
  → adapter kiểm tra ctx.auth
  → ctx.projects xác nhận project thuộc user
  → ctx.sessions.create({ driver: "rlm", projectId, ownerId })
  → SessionRegistry tạo Session domain object trong RAM
  → trả sessionId cho client
```

Project sở hữu nguồn input và output đã publish. Session sở hữu một đoạn chat,
history, extension state và output nháp của chính nó. Nhiều session trong cùng project có cùng
`session.workspaceId = "project:<projectId>"`, nhưng event/memory/REPL vẫn
được định danh bằng sessionId.

### 4.2 Upload dataset

```text
Browser chọn file
  → POST /projects/:id/sources (raw binary; `/files` vẫn tương thích client cũ)
  → api-rest kiểm tra auth + project ownership + giới hạn payload
  → ctx.workspace.writeFile("project:<id>", filename, bytes)
  → provider lưu file
  → nếu là CSV/TSV/XLSX/Parquet, cập nhật index.json
  → GET /projects/:id/sources chỉ trả input cho UI
```

Mọi đường dẫn đều được resolve bên trong workspace của project để chống path
escape. `workspace-local` dùng `data/rlm-workspaces/projects/<projectId>`;
`workspace-docker` dùng một named volume riêng. Input nằm trong `sources/`.
Output RLM mặc định nằm ở `.sessions/<sessionId>/generated/`, vì vậy hai đoạn
chat không ghi đè kết quả của nhau. `POST /projects/:id/outputs` copy một draft
được chọn sang `outputs/` để dùng chung; file cũ trong `generated/` được hiển
thị như output dự án legacy, không bị trộn trở lại tab Nguồn.

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
ctx.turnMemory.snapshot(sessionId)
ctx.workspace.inspect(session.workspaceId)
ctx.skills.get(selectedSkill) / ctx.skills.match(request)
ctx.skillSelection.select(...) khi RLM không có selected/trigger match
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
- selected/triggered/semantic-selected skill nếu có;
- catalog skill nhẹ chỉ gồm `name + description`;
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

### 4.8 Skill discovery và resource bridge

User chọn skill luôn ưu tiên. Trigger rõ là fast path. Khi không có hai
trường hợp trên, default loop để model chính chọn từ catalog và gọi
`skill(name)`; RLM dùng `ctx.skillSelection` làm semantic gate nhỏ trước khi
chuẩn bị turn. Full `SKILL.md` chỉ được nạp sau khi skill được chọn.

Resource được đọc lazy qua tool chung `read_skill_resource(name, path)`;
skill đã preload trong RLM vẫn có convenience function `skill_resource(path)`:

```text
worker __host_skill__
  → ctx.skills.readResource(skillName, path)
  → skill-filesystem đọc resource trong đúng package
```

Skill vẫn là gói hướng dẫn, không phải code tự chạy. Tool `skill`
chỉ là cửa nạp có quan sát được; action thật vẫn qua tool handler/REPL.

### 4.9 Kết thúc turn và memory

```text
worker trả outcome + trajectory + state
  → loop-rlm cập nhật context/history index
  → ctx.turnMemory.completeTurn(...)
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
| Project metadata/ownership | `project-registry` + `state-sqlite` | SQLite; cache RAM khi chạy | Có |
| Session metadata + project binding + history | `session-registry` + `state-sqlite` | SQLite; cache RAM khi chạy | Có, được restore lúc boot |
| Run lifecycle | `agent-runner` | SQLite nếu storage persistent | Có; run đang chạy lúc restart thành `interrupted` |
| Job/pipeline lifecycle | `job-runner` | SQLite | Có record; job chưa xong lúc restart thành `interrupted` |
| Artifact catalog | `artifact-service` | SQLite, trỏ tới file workspace | Có nếu volume workspace còn |
| Event/audit history | `state-sqlite` | `data/sessions.db` | Có nếu volume còn |
| Semantic rolling memory | `memory-rolling` | `data/rlm-memory/*.json` | Có nếu volume còn |
| Dataset/output của project | workspace provider | `data/rlm-workspaces/projects/<projectId>` hoặc Docker volume riêng | Tuỳ provider/volume |
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
| `docker-compose.yml` | Compose duy nhất: service, port, volume, source mount và hot reload | Đổi cách chạy hệ thống |
| `README.md` | Quick start và giới hạn tổng quát | Thay đổi cách chạy chính |
| `tsconfig.json` | Luật typecheck TypeScript | Đổi compiler/module settings |

Compose mount source thuộc chính repo vào container. Backend dùng `tsx watch`,
UI dùng Vite HMR; sửa TypeScript/React/CSS không cần rebuild image.

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
| `auth.ts` | `ctx.auth`: tài khoản Postgres nhiều người dùng thật — signup/login/token/role, không chỉ xác thực token đơn thuần (xem `docs/agent-core-cordis-build-plan.md` Phase 24) |
| `context-compactor.ts` | `ctx.contextCompactor`: đo payload model và compact history trong một request |
| `llm.ts` | `ctx.llm`: model completion |
| `loop.ts` | `ctx.loop`, `Session`, `TurnInput`, `LoopStep`, `LoopTurnResult` |
| `memory.ts` | `ctx.memory`: remember/recall xuyên session/user qua TencentDB Agent Memory (Phase 25) — KHÁC `turn-memory.ts` |
| `turn-memory.ts` | `ctx.turnMemory`: rolling summary theo TỪNG SESSION, dùng riêng cho loop-rlm (tách khỏi `ctx.memory` lúc merge — xem `docs/agent-core-rlm-harness-merge-plan.md` mục 4.1) |
| `permission.ts` | `ctx.permission`: policy check |
| `projects.ts` | `ctx.projects`: project ownership/lifecycle; project sở hữu workspace dùng chung |
| `prompt.ts` | `ctx.prompts`: đăng ký section và render prompt |
| `sandbox.ts` | `ctx.sandbox`: runtime persistent + event protocol |
| `sessions.ts` | `ctx.sessions`: registry session dùng chung transport |
| `skill.ts` | `ctx.skills`: catalog và lazy resource reader |
| `skill-selection.ts` | `ctx.skillSelection`: semantic router tùy chọn cho runtime không tool-call trực tiếp |
| `storage.ts` | `ctx.storage`: append/read event |
| `events.ts` | event envelope có sequence/cursor, dùng cho timeline/polling |
| `jobs.ts` | `ctx.jobs`: queue, progress, cancel và event của background job |
| `artifacts.ts` | `ctx.artifacts`: catalog output có producer/hash/path |
| `pipeline.ts` | `ctx.pipelines`, `ctx.pipelineRuns`: stage registry + chạy pipeline |
| `subagents.ts` | `ctx.subagents`: registry task delegation |
| `tools.ts` | `ctx.tools`: catalog và execution gateway duy nhất (`invoke()` truyền `ToolInvocationContext{sessionId,source}` xuống handler — xem `docs/agent-core-rate-limit-and-security-audit.md` Finding A1) |
| `workspace.ts` | `ctx.workspace`: dataset/artifact/file operations |

Quy tắc: seam không import provider và không chứa logic deployment.

### 6.4 `bundles/providers/`: implementation capability

| Folder | Vai trò |
|---|---|
| `agent-runner` | Queue theo session, idempotency theo requestId, run lifecycle, cancel cooperative |
| `artifact-service` | Đăng ký/list output do RLM hoặc pipeline tạo |
| `context-compactor-llm` | Ước lượng token, structured summary và compact history bằng `ctx.llm` |
| `job-runner` | Queue background có progress/event/cancel; không chạy song song quá `JOB_MAX_CONCURRENT` |
| `pipeline-registry`, `pipeline-runner` | Registry stage/pipeline và điều phối một pipeline qua một job |
| `auth-apikey` | So token với danh sách `API_KEYS` |
| `llm-qwen` | OpenAI-compatible Qwen client, timeout/retry/usage |
| `llm-deepseek` | Provider LLM thay thế |
| `loop-registry` | Map tên driver → implementation |
| `memory-rolling` | Memory JSON có giới hạn + semantic summarization |
| `permission-rbac` | Permission deny-by-default theo actor/action |
| `prompt-registry` | Sort section theo order, ghép prompt, tạo version hash |
| `project-registry` | Project RAM + persistence, owner/name/updatedAt |
| `sandbox-ipython` | Spawn worker Python local và bridge LLM/tool/skill |
| `sandbox-docker` | Biến thể chạy worker trong container riêng |
| `session-registry` | Session RAM, sliding TTL và lifecycle events |
| `skill-filesystem` | Parse `SKILL.md`, discover/read package resources |
| `skill-registry` | Catalog skill trong RAM |
| `skill-selection-llm` | Chọn semantic skill cho RLM khi selected/trigger không có |
| `state-sqlite` | Event store envelope, projects/sessions/runs/jobs/artifacts SQLite và retention sweep |
| `subagent-manager` | Catalog subagent |
| `tool-registry` | Catalog + execution gateway cho tool |
| `workspace-local` | Workspace bằng filesystem local |
| `workspace-docker` | Workspace bằng Docker named volume |

### 6.5 `bundles/loop-drivers/`

| File/folder | Vai trò |
|---|---|
| `loop-default/index.ts` | Loop tool-calling; skill/memory; compact trước mỗi model call; prompt/tool hash mỗi step |
| `loop-planner-critic/index.ts` | Driver thay thế minh hoạ hot-swap |
| `loop-rlm/index.ts` | Orchestrate một RLM turn qua framework seams |
| `loop-rlm/protocol.ts` | Nơi duy nhất dựng `PreparedRlmTurn` contract |
| `loop-rlm/python/worker.py` | JSON-lines bridge giữa TS và `HarnessRLM` |

Không đưa logic REST/UI vào loop. Không để worker tự đọc database/memory/tool
catalog của TypeScript.

### 6.6 Prompt

| File | Vai trò |
|---|---|
| `bundles/prompts/prompt-default-agent/` | Prompt nền chat thường: identity, operating policy, completion |
| `bundles/prompts/prompt-rlm-data-agent/` | Prompt RLM: REPL protocol, data/evidence/human-control policy, completion |
| `bundles/providers/prompt-registry/` | Lọc section theo `drivers`, sort theo `order`, ráp và hash prompt |

Tool plugin tự đăng ký hướng dẫn tool vào prompt registry. Không hardcode danh
sách tool/skill/memory động vào Markdown system prompt.

`drivers` bỏ trống nghĩa là section dùng chung; `drivers: ['default']` hoặc
`['rlm']` cô lập luật riêng. Default loop luôn render prompt framework với
`driver: 'default'`; UI không cần truyền `systemPrompt`. Nếu application có
thêm prompt riêng vào `Session`, thứ tự cuối cùng là:

```text
framework prompt → application/session prompt → skill/catalog/memory notes
```

Mọi phần vẫn được gộp thành đúng một message role `system` ở đầu request.

### 6.7 Context compaction

Default loop gọi `ctx.contextCompactor.inspect()` trước mỗi root model call.
Payload đo gồm đúng messages đã ráp và tool schemas. Khi đạt ngưỡng (mặc định
80% của 30.000 token ước lượng), provider tóm tắt history cũ, giữ nguyên
system prompt và current request, rồi commit history ngắn lại vào `Session`.
Khi default driver đã nhận compactor, hard-trim 40 messages được tắt; checkpoint
compact được lưu trong event để `session-registry` phục hồi đúng summary sau
restart thay vì replay lại raw history đã loại.

```text
messages + tool schemas
  → inspect
  → dưới threshold: complete()
  → trên threshold: compact → replaceHistory → inspect lại → complete()
```

`context_usage` và `context_compacted` được ghi vào storage; lỗi model tóm tắt
có deterministic bounded fallback. Nếu system prompt/current request/tool
schemas tự chúng đã vượt threshold sau compact, turn fail rõ thay vì compact
lặp vô hạn. Đây là compact **trong một request**, khác `ctx.turnMemory` là
rolling summary **giữa các request** của RLM.

### 6.8 Tools, skills và subagents

| Folder | Vai trò |
|---|---|
| `bundles/tools/tool-web-search` | `web_search`, permission + timeout + UI metadata |
| `bundles/tools/tool-database-query` | Query event database qua storage abstraction |
| `bundles/tools/tool-skill` | `skill` nạp instructions và `read_skill_resource` đọc resource cho mọi loop |
| `bundles/skills/<name>/SKILL.md` | Hướng dẫn top-level của skill |
| `bundles/skills/<name>/{assets,references,scripts,...}` | Resource đọc lazy, không phải skill con |
| `bundles/skills/skill-support-tone` | Ví dụ skill plugin viết trực tiếp bằng TS |
| `bundles/subagents/subagent-report-writer` | Ví dụ subagent độc lập dùng permission + LLM |

Nhóm skill dữ liệu hiện có: explore/validate data, data scientist, pandas,
statistics, visualization, SQL insights, feature engineering, model evaluation,
scikit-learn, cohort/funnel/segmentation/time-series và data-quality audit.

### 6.9 Adapters

| Folder | Vai trò |
|---|---|
| `api-rest` | REST health/project/session/message/events/skills/project workspace files |
| `api-ws` | Create session, send message và live `LoopStep` stream |
| `api-grpc` | Unary + server-streaming cho non-browser clients |
| `api-grpc/agent.proto` | Schema gRPC |
| `web-ui` | Serve static React build tại port UI |

Adapter chỉ chuyển transport ↔ domain call. Business logic phải nằm sau seam,
không được fork riêng theo REST/WS/gRPC.

### 6.10 Pipeline ML thay thế được stage

Pipeline là một capability riêng, không phải prompt hoặc tool giả. Pipeline
`tabular-classification` hiện ghép theo thứ tự:

```text
data-load → feature-basic → train-majority hoặc train-flaml
          → validate-split → report-markdown
```

Mỗi stage nhận artifact đầu vào và tạo artifact đầu ra trong workspace. Ví dụ
muốn thay FLAML bằng LightGBM: viết stage `train-lightgbm`, đăng ký nó, rồi
gọi pipeline với `override: { train: 'train-lightgbm' }`. Data/feature/validate
và UI không cần biết train implementation đã đổi. `validate-split` luôn đánh
giá holdout tách trước train để tránh leakage.

### 6.11 Frontend và UI packages

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
| `packages/ui-projects` | Danh sách/tạo project, project detail, tab Đoạn chat/Nguồn/Output và publish draft |

Frontend mới có thể bỏ reference UI và viết lại hoàn toàn, miễn giữ contract
trong `frontend-backend-handoff.md`.

### 6.12 Test và benchmark

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

## 7. Python RLM được đóng gói thế nào?

Runtime nằm ngay trong repo:

```text
bundles/loop-drivers/loop-rlm/python/rlm_agent/harness_adapter.py
bundles/loop-drivers/loop-rlm/python/rlm_agent/agent.py
bundles/loop-drivers/loop-rlm/python/vendor/rlm/rlm/...
bundles/loop-drivers/loop-rlm/python/requirements.txt
bundles/loop-drivers/loop-rlm/python/worker.py
```

`HarnessRLM` là adapter mỏng tới core RLM. Nó nhận prepared context và các
callback bridge từ harness. Những phần gắn trực tiếp với core RLM/REPL chưa có
extension point vẫn nằm ở Python; orchestration cấp application đã chuyển sang
TypeScript.

Core RLM được vendor kèm upstream license để branch là một runtime hoàn chỉnh.
Dockerfile cài requirements và copy source từ chính repo; người dùng không cần
sibling repo hay prebuilt data-agent image. Khi cập nhật upstream RLM phải cập
nhật có chủ đích, giữ license và chạy lại E2E.

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

Viết `description` rõ điều kiện sử dụng vì semantic selector/catalog dựa
vào nó; `triggers` chỉ dùng cho fast path chắc chắn. Không thêm registry
Python thứ hai và không biến resource thành skill con.

### Đổi system prompt

Sửa/thêm section Markdown và đăng ký section với `name/order/drivers`. Prompt
chat thường nằm ở `prompt-default-agent`; prompt REPL nằm ở
`prompt-rlm-data-agent`. Không sửa UI, không gửi prompt nền từ request và
không dựng prompt trong `worker.py`.

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
cd agent-core
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
| gRPC | `localhost:50051` (đổi host port bằng `PORT_GRPC`) |

Kiểm tra code:

```bash
npm run typecheck
npm run build:web
npm test
```

`npm test` tự đặt `NODE_ENV=test`, nên chạy được cả từ Docker runtime vốn đặt
`NODE_ENV=production`. Native dependency `better-sqlite3` phải được chạy bằng
Node 22 như image; không chạy full test bằng Node 20 trên host.

Để kiểm tra pipeline ML chậm hơn (không nằm trong default suite):

```bash
docker run --rm -e RUN_ML_E2E=1 \
  -v "$PWD:/work" -w /work agent-core:latest \
  npx vitest run tests/pipeline-ml-e2e.test.ts
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
- File RLM thuộc project và luôn qua `ctx.workspace`; session chỉ mang projectId/workspaceId, không tự ghép path rải rác.
- Mọi API project/session/file/event phải kiểm tra owner; session có projectId chỉ hợp lệ khi owner của session và project trùng nhau.
- Memory dài hạn xuyên session/user thuộc `ctx.memory`; rolling summary theo từng session (loop-rlm) thuộc `ctx.turnMemory`; event audit thuộc `ctx.storage` — 3 khái niệm khác nhau, không dùng lẫn.
- Mỗi session chỉ có một turn in-flight.
- Worker stdout chỉ chứa JSON-lines protocol; log đi stderr.
- `PreparedRlmTurn` chỉ được dựng ở `loop-rlm/protocol.ts`.
- Thay implementation bằng provider/plugin, không chồng thêm wrapper ở tầng
  ngoài `AgentRunner`.

## 13. So với commit đầu tiên

So sánh commit khởi tạo `2bb50b2` với branch migration tại `30f4120`:

| Tính năng được thêm | File/folder chính |
|---|---|
| RLM trở thành một loop driver của harness | `bundles/loop-drivers/loop-rlm/` |
| Contract TypeScript ↔ Python và worker JSON-lines persistent | `loop-rlm/protocol.ts`, `loop-rlm/python/worker.py` |
| Memory multi-turn, workspace và sandbox có seam/provider riêng | `seams/{memory,workspace,sandbox}.ts`, `bundles/providers/{memory-rolling,workspace-local,workspace-docker,sandbox-ipython,sandbox-docker}/` |
| System prompt default/RLM được ghép từ section plugin có driver/order/version | `seams/prompt.ts`, `bundles/providers/prompt-registry/`, `bundles/prompts/{prompt-default-agent,prompt-rlm-data-agent}/` |
| Skill package và lazy resource bridge từ Python về TypeScript | `bundles/providers/{skill-registry,skill-filesystem}/`, `bundles/skills/`, `bundles/loop-drivers/loop-rlm/python/vendor/rlm/rlm/environments/ipython_repl.py` |
| Tool RLM gọi ngược về host, giữ permission/lifecycle ở TypeScript | `seams/tools.ts`, `bundles/providers/tool-registry/`, `bundles/tools/`, `sandbox-ipython/index.ts` |
| REST/WS/gRPC nhận `selectedSkill`, metadata, stream event; REST quản lý file workspace | `bundles/adapters/api-{rest,ws,grpc}/` |
| UI có upload progress, danh sách workspace và artifact đầu ra | `apps/web/src/App.tsx`, `apps/web/src/style.css` |
| Runtime Python RLM và scientific stack nằm trọn trong bundle sở hữu nó | `bundles/loop-drivers/loop-rlm/python/{rlm_agent/,vendor/rlm/,requirements.txt,worker.py}` |
| Một Compose duy nhất có source mount và hot reload | `Dockerfile.dev`, `docker-compose.yml` |
| Benchmark core, skill, tool, memory, REPL, DABench và multi-turn | `benchmarks/rlm/` |
| Test migration, worker protocol, REST và UI smoke | `tests/rlm-migration.test.ts`, `tests/rlm-worker-protocol.test.ts`, `tests/api-rest.test.ts`, `apps/web/tests/App.smoke.test.tsx` |

Tóm lại, commit đầu tiên là harness plugin cơ bản; hiện tại repo là một backend
data-agent/RLM multi-turn, có UI và deployment standalone nhưng vẫn giữ ranh
giới: TypeScript sở hữu application capability, Python sở hữu RLM execution.
