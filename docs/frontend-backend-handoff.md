# Frontend handoff: agent-core backend contract

Tài liệu này là contract để một frontend độc lập tích hợp với backend
`agent-core`. Frontend không cần biết TypeScript/Cordis internals và không được
tự sở hữu prompt, memory, tool routing hoặc RLM loop.

## 1. Bức tranh tổng thể

```text
Browser frontend
  ├─ REST :8787  ─ session, skills, upload/download, runs/jobs/artifacts
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

- Frontend sở hữu presentation state, connection state và session history
  trong browser.
- Backend sở hữu agent behavior, prompt sections, tool/skill catalog, memory,
  workspace và trạng thái từng turn.
- Frontend **không gửi system prompt mặc định**. Muốn đổi hành vi chung, sửa
  prompt plugin bên backend.
- Mỗi workspace gắn với đúng một `sessionId`. Đổi session phải tải lại danh
  sách file của session đó.

## 2. Chạy backend

Repo `agent-core` hiện self-contained: Python adapter, core RLM và dependency
manifest đều nằm trong `python/`. Chỉ cần clone repo này:

```bash
cd agent-core
cp .env.example .env
# Điền OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL_ID, API_KEYS
docker compose up -d --build
```

Dockerfile tự cài Python + scientific dependencies. Trong container, worker
chạy bằng:

```text
RLM_PYTHON_BIN=/usr/local/bin/python3
RLM_RUNTIME_ROOT=/app/python
```

Không trỏ `RLM_PYTHON_BIN` vào `.venv` trên host: virtualenv có thể chứa
symlink tuyệt đối không tồn tại trong container và gây `spawn ... ENOENT`.

Development/hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Production-like:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
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

Mọi API trừ `/health` và `/ready` yêu cầu một key nằm trong `API_KEYS`.

REST:

```http
Authorization: Bearer <API_KEY>
```

Browser WebSocket không set được custom header, vì vậy dùng query string:

```text
ws://localhost:8788/?key=<URL_ENCODED_API_KEY>
```

Ưu tiên an toàn hơn cho frontend mới: gọi `POST /ws-ticket` bằng Bearer key,
rồi kết nối `ws://localhost:8788/?ticket=<ticket>`. Ticket sống ngắn và dùng
một lần. Query `key` chỉ giữ lại để tương thích client cũ.

Không đưa `.env` hoặc key thật vào Git. Với deployment public, đặt backend sau
reverse proxy và đổi key query-string thành token ngắn hạn; contract hiện tại
được thiết kế cho môi trường nội bộ.

## 4. Flow frontend được khuyến nghị

```text
1. Mở WebSocket có auth
2. Gửi create_session với driver="rlm"
3. Nhận session_created và lưu sessionId
4. Upload dataset qua REST với cùng sessionId (nếu có)
5. Gửi send_message qua WebSocket
6. Render 0..N message type="step"
7. Nhận message type="done"
8. Refresh GET /sessions/:id/files để hiện output mới
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

### Tạo session qua REST

```http
POST /sessions
Content-Type: application/json
Authorization: Bearer ...

{"driver":"rlm","maxSteps":8}
```

```json
{"id":"SESSION_UUID","driver":"rlm","maxSteps":8}
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

### Liệt kê

```http
GET /sessions/:sessionId/files
Authorization: Bearer ...
```

```json
{
  "files": [
    {
      "path": "sales.csv",
      "size": 22302,
      "mtime": "2026-08-22T03:35:29.133Z"
    },
    {
      "path": "generated/summary.html",
      "size": 12044,
      "mtime": "2026-08-22T03:36:44.638Z"
    }
  ],
  "datasets": [
    {
      "id": "sales",
      "filename": "sales.csv",
      "path": "sales.csv",
      "active": true
    }
  ],
  "artifacts": ["generated/summary.html"]
}
```

Frontend nên hợp nhất theo `path` để không render trùng:

- `path` nằm trong `artifacts` → nhãn **Output**.
- `path`/filename nằm trong `datasets` → nhãn **Dataset**.
- Còn lại → nhãn **File**.

Refresh danh sách tại bốn thời điểm:

1. Sau `session_created`.
2. Sau upload thành công.
3. Sau mỗi WebSocket `done`.
4. Khi user bấm Refresh.

### Upload có progress

Giới hạn file đã decode là `70 MiB`. Gửi binary trực tiếp, không chuyển file
thành base64 trong browser:

```http
POST /sessions/:sessionId/files
Content-Type: application/octet-stream
X-File-Name: <encodeURIComponent(file.name)>
Authorization: Bearer ...

<raw file bytes>
```

Dùng `XMLHttpRequest` nếu cần upload progress ổn định:

```ts
const xhr = new XMLHttpRequest()
xhr.open('POST', `${restUrl}/sessions/${sessionId}/files`)
xhr.setRequestHeader('authorization', `Bearer ${apiKey}`)
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
{"path":"sales.csv","size":22302}
```

Giữ một success/error banner sau upload; đừng chỉ dùng toast biến mất nhanh.

Server vẫn hỗ trợ JSON base64 cho client cũ, nhưng frontend mới không nên dùng
vì tốn thêm khoảng 33% payload và dễ gây lỗi memory/call-stack.

### Download dataset/output

```http
GET /sessions/:sessionId/files/:encodedPath
Authorization: Bearer ...
```

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
- Frontend hiện giữ danh sách session của chính browser trong `localStorage`.
- Backend restart làm session registry mất; một ID cũ có thể trả `404` dù UI
  còn giữ history local.
- Khi nhận `404 session not found`, đánh dấu session cũ unavailable và tạo
  session mới; không retry vô hạn.
- Không có `GET /sessions` công khai vì API key hiện chưa biểu diễn ownership
  theo từng end-user.

## 10. File backend cần đọc khi tích hợp

Contract ổn định:

- `seams/loop.ts` — turn result và toàn bộ stream step union.
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

- `python/rlm_agent/` chứa adapter/runtime RLM của application.
- `python/vendor/rlm/` chứa core RLM đã pin và license upstream.
- `python/requirements.txt` là dependency contract của worker/image.
- Frontend contributor không cần đọc Python để dùng public API.
- Backend contributor có thể clone riêng `agent-core` và build E2E; không còn
  runtime dependency vào sibling `data-agent`.
