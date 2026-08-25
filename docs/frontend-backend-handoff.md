# Frontend handoff: agent-core backend contract

Tài liệu này là contract để một frontend độc lập tích hợp với backend
`agent-core`. Frontend không cần biết TypeScript/Cordis internals và không được
tự sở hữu prompt, memory, tool routing hoặc RLM loop.

## 1. Bức tranh tổng thể

```text
Browser frontend
  ├─ REST :8787  ─ projects, sessions, skills, sources/outputs, jobs
  └─ WS   :8788  ─ create/resume turn và stream trạng thái live
                       │
                       ▼
                 AgentRunner
                       │ chọn driver theo session
                       ▼
                  loop "rlm"
          ┌────────────┼──────────────┐
          ▼            ▼              ▼
       prompts       memory      tools / skills
                       │
                       ▼
              Python RLM worker + workspace
```

Quyền sở hữu quan trọng:

- Frontend sở hữu presentation state và connection state. Backend là nguồn
  thật của project/session; browser chỉ cache title hội thoại.
- Backend sở hữu agent behavior, prompt sections, tool/skill catalog, memory,
  workspace và trạng thái từng turn.
- Frontend **không gửi system prompt mặc định**. Muốn đổi hành vi chung, sửa
  prompt plugin bên backend.
- Mỗi RLM workspace gắn với một `projectId`. Nhiều session (đoạn chat) trong
  cùng project dùng chung nguồn/output; project khác không được đọc chéo.

## 2. Chạy backend

Repo `agent-core` hiện self-contained: Python adapter, core RLM và dependency
manifest đều nằm trong `python/`. Chỉ cần clone repo này:

```bash
cd agent-core
cp .env.example .env
# Điền OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL_ID, POSTGRES_PASSWORD
docker compose up -d --build
```

Dockerfile tự cài Python + scientific dependencies. Trong container, worker
chạy bằng:

```text
RLM_PYTHON_BIN=/usr/local/bin/python3
RLM_RUNTIME_ROOT=/app/bundles/loop-drivers/loop-rlm/python
```

Không trỏ `RLM_PYTHON_BIN` vào `.venv` trên host: virtualenv có thể chứa
symlink tuyệt đối không tồn tại trong container và gây `spawn ... ENOENT`.

Chạy hệ thống (một Compose duy nhất, source mount + hot reload):

```bash
docker compose up -d --build
```

Sau khi sửa TypeScript/React/CSS không cần rebuild. Backend tự restart, UI tự
HMR. Nếu sửa Python worker và cần tạo process mới:

```bash
docker compose restart agent-core
```

Các port mặc định trên host:

| Chức năng | URL |
|---|---|
| REST | `http://localhost:8787` |
| WebSocket | `ws://localhost:8788` |
| Reference UI | `http://localhost:8790` |
| gRPC | `localhost:15052` |

Kiểm tra:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/ready
```

## 3. Authentication

Đăng ký/đăng nhập qua `POST /auth/signup` và `POST /auth/login`. Backend trả
Bearer token gắn với user thật; không dùng mật khẩu GitHub hay API key chung.

REST:

```http
Authorization: Bearer <TOKEN>
```

Browser WebSocket không set được custom header, vì vậy dùng query string:

```text
ws://localhost:8788/?token=<URL_ENCODED_TOKEN>
```

Không đưa `.env`, password hoặc token thật vào Git/localStorage ngoài auth
state cần thiết của UI.

## 4. Flow frontend được khuyến nghị

```text
1. `GET /projects` và render danh sách Dự án
2. Tạo/chọn project; upload nguồn qua `/projects/:id/sources`
3. `POST /projects/:id/sessions` để tạo một RLM chat trong project
4. Mở WebSocket có auth và gửi `send_message` bằng sessionId vừa tạo
5. Render 0..N message type="step"
6. Nhận message type="done"
7. Refresh `GET /projects/:id/sources` và `/projects/:id/outputs`
```

Chỉ cho một turn in-flight trên cùng session. Disable nút Send cho tới khi
nhận `done` hoặc `error`.

## 5. WebSocket contract

### Tạo session

Client gửi:

```json
{
  "type": "create_session",
  "driver": "rlm",
  "maxSteps": 8
}
```

`maxSteps` là optional. Không gửi `systemPrompt` từ UI thông thường.

Server trả:

```json
{
  "type": "session_created",
  "id": "SESSION_UUID",
  "driver": "rlm"
}
```

### Gửi một turn

```json
{
  "type": "send_message",
  "sessionId": "SESSION_UUID",
  "message": "Phân tích dataset hiện tại",
  "selectedSkill": "explore-data",
  "metadata": {
    "clientRequestId": "optional-ui-id"
  }
}
```

`selectedSkill` và `metadata` là optional. Skill name phải lấy từ `GET
/skills`, không hardcode danh sách trong frontend.

### Stream

Trong lúc chạy, server gửi nhiều event:

```json
{
  "type": "step",
  "sessionId": "SESSION_UUID",
  "step": {
    "type": "analysis",
    "content": "...",
    "iteration": 1
  }
}
```

Cuối turn:

```json
{
  "type": "done",
  "sessionId": "SESSION_UUID",
  "result": {
    "content": "Final answer",
    "steps": 2,
    "status": "completed",
    "usage": {},
    "tracePath": "optional"
  }
}
```

`result.status` có thể là:

- `completed`
- `waiting_user`
- `waiting_approval`
- `failed`

Lỗi protocol/server:

```json
{ "type": "error", "message": "..." }
```

### Các loại `step`

| `step.type` | Field chính | Gợi ý UI |
|---|---|---|
| `turn_started` | `runId`, `contextIndex?` | trạng thái nội bộ |
| `iteration_started` | `iteration`, `depth?` | timeline nhỏ |
| `analysis` | `content`, `iteration?` | reasoning/status thu gọn |
| `code` | `code`, `iteration?`, `block?` | code block thu gọn |
| `observation` | `stdout`, `stderr`, `success` | output/error của REPL |
| `tool_call` | `name`, `args`, `toolUi?` | tool đang chạy |
| `tool_result` | `name`, `result`, `toolUi?` | kết quả tool |
| `subcall_result` | `data` | chi tiết nâng cao |
| `context_usage` | `data` | token/context indicator |
| `memory_updated` | `data` | trạng thái nhỏ, không phải answer |
| `human_decision` | `control` | form hỏi user/approval |
| `final` | `content` | assistant answer chính |
| `error` | `message` | error banner |
| `iteration_completed` | `iteration`, `duration?` | đóng timeline step |

Không render `analysis`, `code`, `observation`, `context_usage` thành nhiều
assistant answer. Chỉ `final` là câu trả lời chính.

## 6. REST contract

### Public health

```http
GET /health -> 200 {"status":"ok"}
GET /ready  -> 200 {"ready":true}
```

### Skills

```http
GET /skills
Authorization: Bearer ...
```

```json
{
  "skills": [
    { "name": "explore-data", "description": "..." }
  ]
}
```

Chỉ các skill `userInvocable` top-level được trả về.

### Project API cho tab Phân tích dữ liệu

```http
GET /projects
POST /projects                 {"name":"Revenue 2026"}
GET /projects/:projectId
PATCH /projects/:projectId     {"name":"Tên mới"}
GET /projects/:projectId/sessions
POST /projects/:projectId/sessions  {}
```

`POST /projects/:id/sessions` luôn tạo driver `rlm` và trả:

```json
{"id":"SESSION_UUID","driver":"rlm","projectId":"PROJECT_UUID"}
```

Backend lấy owner từ Bearer token, không nhận ownerId từ client. User thường
chỉ thấy/chạm project của mình; session chỉ được chạy khi owner của session và
project trùng nhau.

### Tạo session thường qua REST

```http
POST /sessions
Content-Type: application/json
Authorization: Bearer ...

{"driver":"default","maxSteps":8}
```

```json
{"id":"SESSION_UUID","driver":"default","maxSteps":8}
```

Frontend có thể tạo session bằng REST hoặc WebSocket. Không tạo cả hai cho
cùng một thao tác.

### Gửi message qua REST

REST phù hợp với client không cần live stream:

```http
POST /sessions/:sessionId/messages
Content-Type: application/json
Authorization: Bearer ...

{
  "message":"...",
  "selectedSkill":"optional",
  "metadata":{}
}
```

Response là `LoopTurnResult` giống `done.result` của WebSocket.

### Event history

```http
GET /sessions/:sessionId/events
Authorization: Bearer ...
```

```json
{"events":[...]}
```

Dùng endpoint này khi resume session để dựng lại timeline. Storage event là
nguồn lịch sử; stream WebSocket chỉ là live view.

## 7. Workspace và file output

### Liệt kê nguồn input

```http
GET /projects/:projectId/sources
Authorization: Bearer ...
```

```json
{
  "sources": [
    {
      "path": "sources/sales.csv",
      "size": 22302,
      "mtime": "2026-08-22T03:35:29.133Z"
    }
  ],
  "datasets": [
    {
      "id": "sales",
      "filename": "sales.csv",
      "path": "sources/sales.csv",
      "active": true
    }
  ]
}
```

Tab **Nguồn** chỉ render mảng `sources`; không đưa artifact/output vào đây.

### Liệt kê và publish output

```http
GET /projects/:projectId/outputs
```

Response tách `projectOutputs` đã dùng chung và `sessionOutputs` còn là draft
của từng đoạn chat. Publish một draft:

```http
POST /projects/:projectId/outputs
Content-Type: application/json

{"sessionId":"SESSION_UUID","path":"chart.png"}
```

Backend copy file từ `.sessions/<sessionId>/generated/` sang `outputs/`, không
ghi đè tên đã tồn tại, đồng thời ghi metadata `createdBySession/sourcePath`.
Frontend hiển thị hai nhóm **Output dự án** và **Kết quả từ các đoạn chat**;
nút **Đưa vào dự án** chỉ xuất hiện ở draft.

Refresh danh sách tại bốn thời điểm:

1. Sau khi mở project.
2. Sau upload thành công.
3. Sau mỗi WebSocket `done`.
4. Khi user bấm Refresh.

### Upload có progress

Giới hạn file đã decode là `70 MiB`. Gửi binary trực tiếp, không chuyển file
thành base64 trong browser:

```http
POST /projects/:projectId/sources
Content-Type: application/octet-stream
X-File-Name: <encodeURIComponent(file.name)>
Authorization: Bearer ...

<raw file bytes>
```

Dùng `XMLHttpRequest` nếu cần upload progress ổn định:

```ts
const xhr = new XMLHttpRequest()
xhr.open('POST', `${restUrl}/projects/${projectId}/sources`)
xhr.setRequestHeader('authorization', `Bearer ${token}`)
xhr.setRequestHeader('content-type', 'application/octet-stream')
xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
xhr.upload.onprogress = (event) => {
  if (event.lengthComputable) {
    const percent = Math.round(event.loaded / event.total * 100)
    // update progress UI
  }
}
xhr.send(file)
```

Response:

```json
{"path":"sources/sales.csv","size":22302}
```

Giữ một success/error banner sau upload; đừng chỉ dùng toast biến mất nhanh.

Server vẫn hỗ trợ JSON base64 cho client cũ, nhưng frontend mới không nên dùng
vì tốn thêm khoảng 33% payload và dễ gây lỗi memory/call-stack.

### Download source/output

```http
GET /projects/:projectId/files/:encodedPath
GET /projects/:projectId/outputs/project/:encodedPath
GET /projects/:projectId/outputs/session/:sessionId/:encodedPath
Authorization: Bearer ...
```

Route `files` dùng cho source. Hai route `outputs` lần lượt tải output đã
publish và draft thuộc một session cụ thể.

Không dùng `<a href="...">` trực tiếp vì browser không tự thêm Bearer token.
Dùng authenticated `fetch`, đổi response thành `Blob`, rồi tạo object URL để
download.

## 8. Runs, jobs, artifacts và pipeline

Một chat turn tạo một **run**. UI có thể poll:

```text
GET /sessions/:id/runs
GET /runs/:runId
POST /runs/:runId/cancel
```

Một pipeline dài tạo một **job**. Các endpoint:

```text
GET /sessions/:id/jobs
GET /jobs/:jobId
GET /jobs/:jobId/events
POST /jobs/:jobId/cancel
POST /jobs/:jobId/retry
GET /sessions/:id/artifacts
GET /artifacts/:artifactId
GET /pipelines
POST /pipelines/:name/run
```

Body chạy pipeline:

```json
{
  "sessionId": "SESSION_UUID",
  "override": { "train": "train-flaml" },
  "config": { "train": { "timeBudgetSeconds": 60 } }
}
```

Job events có progress 0..1 và message. Khi job terminal, refresh cả
`/sessions/:id/files` và `/sessions/:id/artifacts`: file là nguồn dữ liệu để
download/render, artifact là metadata (producer, hash, kind) để giải thích
nó được tạo bởi stage nào. Không đoán output chỉ từ text trả lời của model.

## 9. Session lifecycle và resume

- Backend persist session metadata/history và rehydrate cache lúc boot; Python
  REPL vẫn không persistent, turn tiếp theo sẽ mở worker mới.
- `GET /projects` và `GET /sessions` đã lọc theo identity; backend persist cả
  project metadata lẫn session-to-project binding trong SQLite.
- Frontend chỉ cache title session; event history thật lấy từ
  `GET /sessions/:id/events` khi resume.
- Python REPL không sống qua restart, nhưng project sources/outputs vẫn còn
  nếu workspace volume còn.

## 10. File backend cần đọc khi tích hợp

Contract ổn định:

- `seams/loop.ts` — turn result và toàn bộ stream step union.
- `seams/projects.ts` — project ownership/lifecycle contract.
- `seams/workspace.ts` — dataset/artifact/file contract.
- `seams/skill.ts` — skill metadata.

Transport implementation:

- `bundles/adapters/api-rest/index.ts`
- `bundles/adapters/api-ws/index.ts`
- `bundles/adapters/api-grpc/agent.proto` (không dùng trực tiếp từ browser)

Reference frontend:

- `apps/web/src/App.tsx`
- `apps/web/src/settings.ts`
- `apps/web/src/sessionHistory.ts`

Composition root:

- `src/serve.ts`

## 11. Checklist frontend trước khi bàn giao

- [ ] API key không hardcode trong source/bundle.
- [ ] WebSocket connect bằng URL-encoded key.
- [ ] Session luôn tạo với `driver: "rlm"`.
- [ ] Frontend không gửi system prompt mặc định.
- [ ] Chỉ một turn chạy đồng thời trên một session.
- [ ] Render `final` đúng một lần thành assistant answer.
- [ ] Error WS/REST được hiện rõ cho user.
- [ ] Skill selector lấy dữ liệu từ `/skills`.
- [ ] Upload gửi raw binary và có progress/success/error state.
- [ ] Workspace refresh sau upload và sau `done`.
- [ ] Dataset và output được hợp nhất theo path, không render trùng.
- [ ] Download dùng authenticated fetch.
- [ ] Resume xử lý được session đã hết TTL/backend restart.
- [ ] Có UI cho run/job đang chạy và nút cancel khi state cho phép.
- [ ] Output panel lấy files + artifacts từ backend, không suy luận từ chat.
- [ ] Không hiển thị internal memory/context JSON như final answer.

## 12. Trạng thái verify hiện tại

Đã kiểm tra trên Docker Compose:

- Container health/ready: pass.
- Python worker khởi động và phát `__ready__`: pass.
- RLM REST turn end-to-end: HTTP `200`, status `completed`.
- Binary upload → list → authenticated download: pass.
- Workspace phân loại Dataset/Output: pass.
- Progress bar được kiểm tra trong Chrome headless với upload throttled: có
  cập nhật phần trăm.
- Targeted REST/UI tests trên Node 22: `11/11` pass.

Generated benchmark reports trong `reports/` không phải source code và không
nên commit. Benchmark definitions/runner trong `benchmarks/` có thể commit để
người backend tái lập kết quả.

## 13. Python runtime trong repo

- `bundles/loop-drivers/loop-rlm/python/` — nằm HẲN TRONG bundle sở hữu nó
  (chuẩn cấu trúc plugin, xem `docs/plugin-standard-structure.md`), không
  còn ở `python/` root repo.
- `.../python/rlm_agent/` chứa adapter/runtime RLM của application.
- `.../python/vendor/rlm/` chứa core RLM đã pin và license upstream.
- `.../python/requirements.txt` là dependency contract của worker/image.
- Frontend contributor không cần đọc Python để dùng public API.
- Backend contributor có thể clone riêng `agent-core` và build E2E; không còn
  runtime dependency vào sibling `data-agent`.
