# Web UI hiện dùng flow RLM thế nào — và vì sao chưa phù hợp

> **Cập nhật (đã implement `docs/agent-core-rlm-web-ui-plugin-plan.md`)**:
> mục 1 dưới đây (driver `"rlm"` mặc định cho MỌI session) **KHÔNG còn
> đúng nữa** — mặc định đã đổi về `"default"`, RLM giờ là lựa chọn chủ
> động qua nút "Phân tích dữ liệu" trong Sidebar, workspace bar/skill-select
> đã tách thành UI-plugin thật (`packages/ui-rlm-workspace`), chỉ hiện cho
> session driver `"rlm"`. Giữ nguyên mục 1 dưới đây làm hồ sơ mô tả trạng
> thái TẠI THỜI ĐIỂM khảo sát (trước khi tách) — không sửa lại theo trạng
> thái mới, xem plan trên để biết chính xác cái gì đã đổi.
>
> **Mục 2-4 (2 nguồn dữ liệu, bảng đối chiếu 14 loại `LoopStep`, nguyên
> nhân lệch) VẪN ĐÚNG NGUYÊN VẸN** — việc tách UI-plugin không đụng gì tới
> `applyStep()`/`reconstructItems()`, đây vẫn là việc RIÊNG, chưa làm (xem
> mục 5 doc này).

Doc riêng theo yêu cầu: mô tả ĐÚNG cách `apps/web` hiện đang chạy flow RLM
(driver `"rlm"`, mặc định cho MỌI session mới — xem mục 1, **ĐÃ LỖI THỜI,
xem cập nhật ở trên**), và chỉ rõ bằng bảng đối chiếu code thật tại sao UI
hiện tại không theo kịp lượng thông tin RLM thật sự phát ra. Đây là tài
liệu **khảo sát cho việc lên kế hoạch update UI**, không phải đã sửa gì —
không có thay đổi code nào trong doc này.

## 1. Flow người dùng thật hiện tại (đọc trực tiếp `apps/web/src/App.tsx`)

```
1. Mở :8790 → chưa đăng nhập → LoginForm/SignupForm (packages/ui-auth)
2. Đăng nhập xong → Sidebar + AppFrame hiện ra, tự động connect WS
   → gửi 'create_session' với driver CỐ ĐỊNH = 'rlm'
   (App.tsx: `export const UI_AGENT_DRIVER = 'rlm'`, KHÔNG có cách nào
   trong UI hiện tại để tạo session dùng loop-default/planner-critic —
   web UI bây giờ CHỈ nói chuyện với RLM, dù backend vẫn hỗ trợ cả 3 driver)
3. Header hiện thêm 1 "workspace bar" (mới từ merge RLM):
   - đếm dataset/output đã có
   - nút "📎 Upload file" (.csv/.tsv/.xlsx/.xls/.parquet/.json/.txt,
     tối đa 70 MiB) → POST /sessions/:id/files, tiến trình % qua XHR
   - nút "↻ Refresh"
   - danh sách file (bấm để tải lại), phân loại Dataset/Output/File qua
     workspace.inspect() snapshot
4. Footer: dropdown "Chọn skill" (population từ GET /skills, danh sách
   skill userInvocable) + ô nhập tin nhắn (Composer) — chọn "Tự động" =
   không set selectedSkill, để RLM tự quyết định
5. Gửi tin nhắn → WS 'send_message' {sessionId, message, selectedSkill?}
   → server chạy loop-rlm → stream 'step' events → applyStep() render
   TỪNG BƯỚC vào khung chat (mục 3 giải thích CHÍNH XÁC bước nào hiện ra,
   bước nào KHÔNG)
6. Click 1 session cũ trong Sidebar → resumeSession() → GET
   /sessions/:id/events → reconstructItems() dựng lại UI từ event đã lưu
   (khác cơ chế với step LIVE — xem mục 2)
```

Phần workspace bar/skill-select/upload nhìn chung ỔN, đã khớp đúng
endpoint backend thật (`/sessions/:id/files`, `/skills` — xem
`docs/agent-core-rlm-harness-components.md` mục 2). **Chỗ không ổn nằm ở
bước 5-6** — phần hiện luồng suy nghĩ/hành động của RLM khi đang chạy.

## 2. Có 2 nguồn dữ liệu khác nhau, 2 hàm xử lý khác nhau — chi tiết dễ bị bỏ sót

- **Step LIVE (qua WS)**: `loop-rlm/index.ts`'s `toStep()` (TypeScript)
  convert event thô từ Python SANG shape `LoopStep` (seams/loop.ts) trước
  khi `emit('agent/step', ...)` — App.tsx nhận qua `ws.addEventListener
  ('message', ...)`, gọi `applyStep(step)`.
- **Event đã lưu, đọc lại lúc resume** (`GET /sessions/:id/events`):
  `loop-rlm/index.ts` ghi `storage.appendEvent(sessionId, {...event,
  source:'rlm'})` — đây là **event THÔ từ Python** (trước khi qua
  `toStep()`), field name khác (`final_answer` thay vì `final`, không có
  `decisionSummary`...). App.tsx đọc lại qua `reconstructItems(events)` —
  hàm RIÊNG, code RIÊNG, KHÔNG dùng chung logic với `applyStep()`.

Hệ quả: 2 hàm phải tự đồng bộ tay với nhau cho từng loại step — dễ lệch
(mục 3 chỉ ra 1 chỗ đã lệch thật: `analysis`).

## 3. Bảng đối chiếu: RLM phát ra 14 loại step, UI hiện chỉ xử lý 6

Cột "Nguồn" = ai thật sự phát loại step này. `toStep()` trong
`bundles/loop-drivers/loop-rlm/index.ts` convert từ event Python sang
đúng 1 trong 14 case của `LoopStep` (`seams/loop.ts`).

| `LoopStep.type` | Ý nghĩa thật | `applyStep()` (live, App.tsx) | `reconstructItems()` (resume, App.tsx) |
|---|---|---|---|
| `turn_started` | RLM bắt đầu 1 turn, có `runId`/`contextIndex` | ❌ không xử lý | ❌ không xử lý |
| `iteration_started`/`iteration_completed` | 1 vòng lặp REPL bắt đầu/xong, có `iteration`/`depth`/`duration` | ❌ không xử lý | ❌ không xử lý |
| `analysis` | Model giải thích bước tiếp theo TRƯỚC khi chạy code | ✅ → note "🔍 ..." | ❌ **không xử lý** (bất nhất với live — bug thật, không phải cố ý) |
| `code` | Đoạn code Python THẬT sắp chạy trong REPL | ❌ không xử lý — **người dùng không thấy code nào đang chạy** | ❌ không xử lý |
| `observation` | stdout/stderr/success của đoạn code vừa chạy | ❌ không xử lý — **không thấy kết quả/lỗi thật sự của code** | ❌ không xử lý |
| `tool_call` | RLM gọi 1 tool qua REPL (`web_search(...)`) — type RIÊNG, KHÔNG phải `model_message.toolCall` | ❌ không xử lý — khác cơ chế `model_message.toolCall` mà `applyStep` đang bắt | ❌ không xử lý |
| `tool_result` | Kết quả tool RLM vừa gọi | ⚠️ có nhánh xử lý, NHƯNG chỉ cập nhật card đã tạo bởi `model_message.toolCall` — RLM không bao giờ tạo card đó (dùng `tool_call` riêng ở trên), nên nhánh này luôn no-op cho RLM (`activeId` null) | ⚠️ cùng vấn đề (`pendingToolId` null) |
| `subcall_result` | Kết quả 1 lời gọi model con (recursive call) | ❌ không xử lý | ❌ không xử lý |
| `context_usage` | Cập nhật token/context đã dùng | ❌ không xử lý | ❌ không xử lý |
| `memory_updated` | `ctx.turnMemory.completeTurn()` vừa chạy xong, có `quality`/`summary` | ❌ không xử lý | ❌ không xử lý |
| `human_decision` | RLM tạm dừng, cần user quyết định (`ask_user(...)`) | ✅ → note hệ thống hỏi lại | ✅ → note hệ thống |
| `critic_message` | (từ `loop-planner-critic`, không phải RLM) | ✅ | ✅ |
| `final`/`final_answer` | Câu trả lời cuối cùng | ✅ → bubble assistant | ✅ (đọc field `final_answer` — tên khác lúc lưu, xem mục 2) |
| `error` | Turn lỗi | ✅ → bubble lỗi | ✅ |

**Tóm lại bằng số**: 14 loại step RLM có thể phát ra, UI hiện chỉ thật sự
hiện đúng **4 loại** (`analysis` live-only, `human_decision`, `final`,
`error`) + card tool KHÔNG BAO GIỜ hoạt động cho RLM dù có vẻ có code xử
lý. Nghĩa là trong lúc RLM chạy nhiều vòng lặp REPL thật (có thể vài chục
giây tới vài phút cho task phân tích dữ liệu phức tạp), người dùng chỉ
thấy im lặng hoặc thỉnh thoảng 1 dòng "🔍 ..." — không thấy code đang chạy,
không thấy nó vừa gọi tool gì, không thấy output/lỗi của từng bước, không
có chỉ báo tiến trình (iteration nào/mấy trên tổng). Đây gần như chắc chắn
đúng cảm giác "UI không phù hợp" bạn đang thấy.

## 4. Vì sao lệch — không phải bug ngẫu nhiên

`applyStep()`/`reconstructItems()` là code CŨ, viết từ Phase 9.4 cho
`loop-default` (chỉ có `model_message`/`tool_result`/`final`) rồi Phase 5
thêm `critic_message` cho `loop-planner-critic`. Lúc merge RLM,
`LoopStep` (seams/loop.ts) được MỞ RỘNG thêm 9 case mới (tự động, vì đó là
phần seam merge sạch không conflict — xem `docs/agent-core-rlm-harness-merge-plan.md`
mục 3.3), nhưng **không ai cập nhật `applyStep()`/`reconstructItems()`
theo** — 2 hàm này thuộc `App.tsx`, nằm trong đúng vùng conflict tôi phải
resolve thủ công lúc merge, và tôi giữ nguyên logic RENDER cũ (chỉ ráp lại
cấu trúc AppFrame/workspace-bar), không tự ý thêm case mới cho RLM vì đó
là quyết định UI/UX (chọn hiện gì, hiện thế nào) — không thuộc phạm vi
"sửa chỗ không tương thích" lúc merge.

## 5. Gợi ý phạm vi cần update (liệt kê để bạn quyết định, CHƯA làm gì)

Không đề xuất implement ngay — đây là input cho bạn lên kế hoạch:

1. **Tối thiểu, an toàn**: thêm nhánh `analysis` vào `reconstructItems()`
   (chỉ 3 dòng, vá đúng bug bất nhất mục 3) — không đổi UX, chỉ đồng bộ.
2. **Tool call cho RLM**: `applyStep()` cần tạo tool card ngay ở
   `step.type === 'tool_call'` (không đợi `model_message.toolCall` nữa) —
   RLM's `tool_result` mới có `activeId` để khớp vào.
3. **Hiện code + observation**: cần quyết định UI mới (accordion "xem
   code đã chạy"? inline như tool card? ẩn mặc định, mở khi bấm?) — đây là
   thay đổi UX thật, không phải vá nhỏ.
4. **Tiến trình iteration**: `turn_started`/`iteration_started`/
   `iteration_completed` đủ dữ liệu (`iteration`, `depth`, `duration`) để
   làm 1 chỉ báo "đang ở vòng lặp N" — hiện `showStreamingRow` chỉ có 1
   trạng thái shimmer chung, không phân biệt được RLM đang ở bước nào.
5. **`context_usage`/`memory_updated`**: có thể chỉ cần hiện dạng debug/
   phụ (không phải trọng tâm chat), hoặc bỏ qua có chủ đích — cần bạn
   quyết định mức độ chi tiết muốn lộ ra cho user thường.
6. Xem xét: có cần route riêng "Chọn driver" trong UI nữa không, hay chốt
   hẳn web UI chỉ dành cho RLM (như hiện tại, `UI_AGENT_DRIVER` cố định)?
   Nếu chốt hẳn, nên dọn code liên quan `critic_message` (chỉ
   `loop-planner-critic` dùng, không liên quan RLM) khỏi các đường render
   chính để đỡ rối, hoặc giữ nguyên nếu vẫn muốn hỗ trợ đa driver qua API
   khác (REST/gRPC) dù web UI không lộ ra.
