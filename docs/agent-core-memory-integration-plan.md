# Tích hợp TencentDB Agent Memory vào `ctx.memory` — plan

> **Cập nhật trạng thái**: đã build xong VÀ đã verify end-to-end thật qua
> `docker compose up --build` (remember→recall thật qua curl, cô lập đúng
> theo user) — xem **Phase 25** trong
> [`docs/agent-core-cordis-build-plan.md`](agent-core-cordis-build-plan.md)
> cho danh sách đầy đủ những gì đã build + 3 gap thật phát hiện lúc verify
> (2 bug Cordis/prompt-assembly, 1 bug thiếu header bootstrap). Doc dưới đây
> giữ nguyên làm tài liệu tham chiếu cho GIAI ĐOẠN RESEARCH/DESIGN ban đầu —
> không cập nhật lại theo implementation cuối cùng, đọc Phase 25 để biết
> chính xác cái gì đã build.

Doc tham chiếu: memory-db là gì, tại sao tích hợp, kiến trúc đề xuất, và các
quyết định còn cần chốt trước khi build (đã chốt xong, xem Phase 25).

## 1. memory-db là gì (research thật, không suy đoán)

`/Users/tyler/Documents/workspace/fpt-telecom/agent-harness-plugin/memory-db`
là **TencentDB Agent Memory** — sản phẩm mã nguồn mở thật của Tencent, MIT
license (xác nhận qua `LICENSE`), ra mắt < 1 tháng (changelog: `2.0.0-beta.1`
21/07/2026 → `2.0.1-beta.1` 13/08/2026 — còn khá non, `ROADMAP.md` liệt kê
nhiều phần chưa xong: sửa memory L1-L3, full-text search L0/L1...).

4 thành phần, mỗi cái tự deploy được (Node.js ≥22 + TypeScript, có Dockerfile
riêng, image build sẵn trên Docker Hub `agentmemory/*`):

| Component | Vai trò | Có cần cho agent-core không |
|---|---|---|
| `MemoryCore` | Engine lưu/truy xuất memory thật (L0 hội thoại thô → L1 fact trích xuất → L2 tóm tắt task → L3 profile dài hạn), SQLite, port 8420 | **CÓ** — đúng thứ `seams/memory.ts` cần |
| `MemoryKnowledge` | Wiki + CodeGraph (đọc code, dựng call-graph) — cho agent lập trình dùng IDE | Không — agent-core không có tính năng đọc/duyệt codebase |
| `MemoryPanel` | Control-plane admin UI quản lý Team/Agent/Task/ACL | Không — không cần multi-team lúc này |
| `MemoryProxy` | Reverse proxy đứng trước LLM, tự chèn context memory/skill vào request | Không — agent-core đã có `ctx.skills`/loop driver tự ráp prompt, không cần lớp proxy ngoài |

**Chỉ `MemoryCore` liên quan** — 3 cái còn lại giải quyết bài toán khác (coding
agent nhiều team/nhiều IDE), không phải nhu cầu thật của agent-core hiện tại.

**SDK TypeScript có sẵn, đã publish npm**: `@tencentdb-agent-memory/memory-sdk-ts-v2`
(bản mới nhất `1.0.0-beta.1`, MIT, **zero dependency** — verify thật qua
`npm view`, không suy đoán). `MemoryClient` cần `endpoint`/`apiKey`/`serviceId`
+ `teamId`/`agentId`/`userId` (cách ly bắt buộc theo 3 trục này), `sessionId`
tuỳ chọn:

```ts
const client = new MemoryClient({
  endpoint: 'http://memory-core:8420',
  apiKey: '...', serviceId: '...',
  teamId: '...', agentId: '...', userId: '...',
})
await client.addConversation({ session_id, messages: [{ role: 'user', content: text }] })
const { messages } = await client.searchConversation({ session_id, query, limit })
```

**Gap thật cần biết trước khi map vào `seams/memory.ts`**: L1 (`searchAtomic`,
fact đã trích xuất) được điền BẤT ĐỒNG BỘ bởi 1 pipeline nền — gọi ngay sau
`addConversation()` sẽ KHÔNG thấy fact vừa lưu. `recall()` phải map vào
`searchConversation()` (L0, BM25/hybrid, có ngay lập tức) để giữ đúng hợp
đồng đồng bộ remember→recall mà `seams/memory.ts` đã định nghĩa, không phải
`searchAtomic()`.

**Deploy**: `MemoryCore` đứng riêng (1 container, image `agentmemory/memory-core`
từ Docker Hub) — **không cần Postgres/Redis/vector DB nào** ("无外部依赖,
可以独立起" — tự đọc từ `deploy/global-images/README.md`), chỉ cần SQLite nội
bộ (đã có sẵn trong image) + 1 LLM API key RIÊNG cho việc trích xuất/tóm tắt
(`TDAI_LLM_API_KEY`/`TDAI_LLM_BASE_URL`/`TDAI_LLM_MODEL`) — **tách biệt hoàn
toàn** với `OPENAI_API_KEY` agent-core đang dùng cho chat thật. 2 bộ config
LLM độc lập, không dùng chung.

## 2. Vấn đề thật mà việc này giải quyết cho agent-core

- **`ctx.memory` từ Phase 1 tới giờ chỉ có interface, chưa từng có provider**
  — đã ghi nhận nhiều lần trong README "Ngoài phạm vi". Đây là lúc lấp gap đó.
- **`Session.history` bị trim cứng ở `maxHistoryMessages=40`** (coding rule
  A14) — context cũ hơn ngưỡng này **mất vĩnh viễn** trong lượt hội thoại đó.
  Có memory thật, agent vẫn "nhớ" được fact cũ dù đã bị trim khỏi cửa sổ
  đang hoạt động.
- **Mỗi `Session` hiện tại cô lập hoàn toàn** — user quay lại mở 1 session
  MỚI thì agent không biết gì về những gì đã nói ở các session trước đó.
  Đây chính là năng lực "cross-session memory" mà 1 hệ memory thật mang lại
  — trước module Auth (Phase gần nhất) thì "user" còn chưa có danh tính thật
  để gắn memory vào; giờ ĐÃ có `AuthIdentity.userId` thật, ghép vừa khít.

## 3. Kiến trúc đề xuất (đúng seam-first, giống mọi provider khác trong repo)

`seams/memory.ts` **giữ nguyên** interface đã có (`remember(sessionId, text)`,
`recall(sessionId, query, limit?)`) — không cần đổi seam, chỉ cần viết
provider thật lần đầu tiên:

```
bundles/providers/memory-tencentdb/index.ts   (MỚI)
```
- Dùng thẳng SDK npm `@tencentdb-agent-memory/memory-sdk-ts-v2` (zero
  dependency, không cần vendor source).
- `remember(sessionId, text)` → `client.addConversation({ session_id: sessionId, messages: [{ role: 'user', content: text }] })`.
- `recall(sessionId, query, limit)` → `client.searchConversation({ session_id: sessionId, query, limit })`, map `messages[].content` + `.score` → `MemoryEntry`.
- **Coding rule A17 áp dụng**: mọi gọi ra `MemoryCore` (network thật) PHẢI có
  timeout tường minh (`AbortController`), giống `tool-web-search` đã sửa ở
  Phase 11 — network lạ, không được để treo cả turn.
- Lỗi từ MemoryCore (timeout, service down...) KHÔNG được làm cả turn fail
  — `remember()`/`recall()` nên "best-effort": log lỗi, trả mảng rỗng/bỏ qua,
  không throw lên loop driver (memory là tăng cường, không phải core-path).

**Docker**: thêm 1 service `memory-core` vào `docker-compose.yml`, dùng
thẳng image build sẵn `agentmemory/memory-core` (KHÔNG build từ Dockerfile
của repo memory-db — tránh phụ thuộc cross-repo build context mong manh),
named volume riêng cho SQLite của nó, healthcheck riêng. `agent-core` service
thêm `depends_on: memory-core: condition: service_healthy` + env
`MEMORY_CORE_URL`.

**Env var mới cho agent-core**: `MEMORY_CORE_URL`, `MEMORY_CORE_API_KEY`,
`MEMORY_CORE_SERVICE_ID` (bắt buộc nếu mount provider này — nhưng **mount
`ctx.memory` vẫn nên là TUỲ CHỌN** ở `src/serve.ts`, giống tinh thần "seam có
sẵn, provider optional" đã áp dụng cho `sandbox`/`memory` từ đầu — không mọi
deployment đều cần/muốn thêm 1 service nữa).

**Env var mới cho container `memory-core`** (khai trong `docker-compose.yml`,
KHÔNG trộn với biến của agent-core): `TDAI_LLM_API_KEY`, `TDAI_LLM_BASE_URL`,
`TDAI_LLM_MODEL` — LLM riêng cho việc trích xuất/tóm tắt nội bộ của MemoryCore.

**Nối vào loop thật** (không chỉ mount rồi bỏ đó — đúng bài học "không nửa
vời" đã rút ra ở skill Phase 15):
- `recall()` gọi Ở ĐÂU: tái dùng CHÍNH CƠ CHẾ đã có cho skill —
  `Session.buildPrompt(userMessage, extraSystemNotes)` (seams/loop.ts) đã
  nhận `extraSystemNotes: string[]` để chèn thêm context 1 lượt, không ghi
  vĩnh viễn vào history. `loop-default`/`loop-planner-critic` gọi thêm
  `runCtx.memory?.recall(session.id, userMessage, 3)` (optional-chain vì
  provider có thể không mount), format kết quả thành 1-2 dòng, gộp chung
  mảng với skill instructions đã match — **không cần cơ chế mới, dùng lại
  đúng chỗ đã có**.
- `remember()` gọi Ở ĐÂU: `AgentRunner.runTurn()` — entrypoint ổn định
  DUY NHẤT cho mọi driver (coding rule B4), đúng chỗ `user_message` đã được
  lưu vào `ctx.storage` ở Phase 13. Gọi `ctx.memory?.remember(session.id, userMessage)`
  ngay cạnh dòng `ctx.storage.appendEvent(...)` đã có.

## 4. Quyết định còn cần chốt trước khi build (chưa tự quyết vì ảnh hưởng thiết kế)

1. **`teamId`/`agentId` map vào đâu?** agent-core không có khái niệm "team"
   hay "nhiều agent" — cần 1 giá trị cố định (vd. `teamId: 'agent-core'`,
   `agentId: 'default'`) hay có ý định mở rộng sau? `userId` thì đã rõ — map
   thẳng `AuthIdentity.userId` từ module Auth vừa xong.
2. **`recall()` có chặn lượt hội thoại không?** Mỗi lượt giờ thêm 1 round-trip
   HTTP (và bản thân MemoryCore có thể tự gọi LLM để search hybrid) — có nên
   set timeout ngắn (vd. 1-2s) rồi bỏ qua nếu chậm, hay chấp nhận chờ lâu hơn
   đổi lấy kết quả đầy đủ hơn?
3. **Mount mặc định hay tuỳ chọn?** Đề xuất: tuỳ chọn (giống mọi seam khác) —
   thiếu `MEMORY_CORE_URL` thì bỏ qua hẳn `ctx.memory`, hệ thống vẫn chạy
   bình thường như hiện tại (không breaking change).
4. **Chi phí LLM kép**: MemoryCore tự gọi LLM riêng để trích xuất fact/tóm tắt
   — có API key/budget riêng cho việc này chưa, hay dùng tạm chung
   endpoint/model với `OPENAI_*` hiện có của agent-core (rẻ hơn nhưng 2 mối
   quan tâm khác nhau dùng chung 1 tài nguyên)?

## 5. Rủi ro cần lưu ý (ghi rõ, không phải "sẽ ổn thôi")

- **Phần mềm còn non** (< 1 tháng tuổi, còn nhiều gap trong ROADMAP) — không
  nên coi là production-hardened, cần test kỹ trước khi phụ thuộc thật.
- **1 dòng lệch trong chính docs của memory-db**: `README.docker.md` của nó
  ghi "License: Proprietary — Tencent Cloud" ở cuối, mâu thuẫn với file
  `LICENSE` gốc (MIT) và mọi README con khác (đều ghi MIT) — nhiều khả năng
  là docs nội bộ sót lại, không phải điều khoản thật, nhưng đáng lưu ý.
- **Thêm 1 service + 1 bộ LLM config nữa** = thêm 1 điểm có thể fail khi
  deploy — đúng lý do đề xuất mount TUỲ CHỌN (mục 4.3), không bắt buộc.

**Cấu hình LLM (mặc định Qwen, vẫn switch được) + patch source cần thiết bên
`memory-db`**: tách riêng thành 1 doc độc lập, tự đủ ngữ cảnh, để đưa thẳng
cho phía làm việc trên source memory-db —
[`memory-db/MemoryCore/docs/agent-core-llm-adapter.md`](../../memory-db/MemoryCore/docs/agent-core-llm-adapter.md).

## 6. Thứ tự build đề xuất (khi đã chốt xong mục 4)

1. Thêm `@tencentdb-agent-memory/memory-sdk-ts-v2` vào `package.json` gốc.
2. `bundles/providers/memory-tencentdb/index.ts` + test riêng (mock HTTP,
   không cần MemoryCore thật chạy để unit-test logic map request/response).
3. `docker-compose.yml` thêm service `memory-core` + env vars 2 phía.
4. Nối `recall()` vào `loop-default`/`loop-planner-critic` qua
   `extraSystemNotes`, `remember()` vào `AgentRunner.runTurn()`.
5. `src/serve.ts`: mount tuỳ chọn (chỉ mount nếu `MEMORY_CORE_URL` có set).
6. Verify thật: `docker compose up --build` (3 container: agent-core +
   postgres + memory-core), gửi 1 tin nhắn thật, xác nhận `MemoryCore` nhận
   được `addConversation`, gửi tin nhắn liên quan ở lượt sau xác nhận
   `recall()` trả về đúng nội dung đã nhớ.
