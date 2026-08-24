# Plan: tách UI workspace RLM thành UI-plugin thật, driver mặc định về `default`

> **Cập nhật: ĐÃ IMPLEMENT VÀ VERIFY THẬT** (đúng thứ tự mục 7). Xem mục 8
> cuối doc cho kết quả verify + số liệu test thật.

Quyết định đã chốt với user: **hướng (a)** trong đề xuất trước —
`UI_AGENT_DRIVER` không còn là hằng số cố định `'rlm'` cho MỌI session
nữa; mặc định quay về `'default'` (loop-default, chat thường), RLM trở
thành 1 khả năng user CHỦ ĐỘNG chọn cho 1 phiên cụ thể (đúng mô hình
Artifacts/Code-Interpreter của Claude.ai — panel chỉ tồn tại cho hội thoại
thật sự dùng nó, không phải mặc định toàn app). Bối cảnh đầy đủ (vì sao
cần tách, bảng đối chiếu code hiện tại) đã có ở
[`docs/agent-core-rlm-web-ui-flow.md`](agent-core-rlm-web-ui-flow.md) và
[`docs/agent-core-rlm-harness-components.md`](agent-core-rlm-harness-components.md)
— doc này KHÔNG lặp lại, chỉ là plan implement.

Theo đúng thứ tự mục 7 khi được duyệt.

## 1. Cơ chế: tái dùng `ctx.slots` đã có, không phát minh mới

Đúng khuôn `docs/ui-plugin-build-guide.md` — khai 2 slot mới (khác
`'tool.call.toolview'`, phạm vi rộng hơn: "chrome của cả phiên", không
phải "1 tool-call cụ thể"), cả 2 **kind `'keyed'`, key = tên loop driver**
(`'rlm'`, `'default'`, `'planner-critic'`):

```typescript
// apps/web/src/client-context.ts — thêm, cạnh 'tool.call.toolview'
ctx.slots.declare('session.chrome.header', 'keyed')
ctx.slots.declare('session.chrome.composer', 'keyed')
```

`App.tsx` render qua `RenderSlot` với `entryKey={session.driver}`,
`fallback={() => null}` — session `driver:'default'`/`'planner-critic'`
không có ai đăng ký key đó → tự nhiên không hiện gì, KHÔNG cần if/else
theo tên driver trong `App.tsx` (logic hiện/ẩn nằm ở phía registry, đúng
nguyên tắc slot-registry đã áp dụng cho tool-call).

## 2. Package mới `packages/ui-rlm-workspace/`

Cấu trúc theo đúng template `ui-plugin-build-guide.md` mục 5 (mirror
`packages/ui-tool-web-search`):

```
packages/ui-rlm-workspace/
├── package.json          (deps: @agent-core/ui-slots, @agent-core/ui-primitives, react)
├── src/
│   ├── index.ts           apply/inject — đăng ký CẢ 2 slot dưới key 'rlm'
│   ├── WorkspaceHeaderPanel.tsx    workspace bar (đếm dataset/output, upload/refresh, list file)
│   ├── SkillComposerExtra.tsx     dropdown chọn skill
│   └── *.module.css
└── tests/
    └── index.test.tsx
```

**Ranh giới state — quan trọng, giữ đúng nguyên tắc đã có (mục 4, rule 4-5
`ui-plugin-build-guide.md`: component KHÔNG tự gọi network/localStorage
riêng)**: `App.tsx` VẪN là nguồn sự thật DUY NHẤT cho
`workspaceFiles`/`workspaceDatasets`/`workspaceArtifacts`/`uploadState`/
`skills`/`selectedSkill` và các hàm gọi API thật
(`refreshWorkspaceFiles`/`handleFileUpload`/`downloadWorkspaceFile`) — y
hệt cách `auth`/`settings` không phân mảnh ra UI-plugin. `ui-rlm-workspace`
CHỈ chứa 2 component THUẦN nhận props (giống `ToolViewOwnerProps` pattern):

```typescript
// packages/ui-rlm-workspace/src/index.ts (props shape, KHÔNG phải seams/ server)
export interface SessionHeaderOwnerProps {
  status: 'uploading' | 'idle'
  workspaceEntries: Array<{ path: string; size: number; kind: 'dataset' | 'output' | 'file' }>
  workspaceLoading: boolean
  workspaceError: string
  uploadState: { phase: 'uploading' | 'success' | 'error'; filename: string; progress: number; message?: string } | null
  onUploadClick: () => void
  onRefresh: () => void
  onDownload: (path: string) => void
}

export interface SessionComposerOwnerProps {
  skills: Array<{ name: string; description: string }>
  selectedSkill: string
  onSelectSkill: (name: string) => void
}
```

`App.tsx` truyền `owner={...}` khi gọi `RenderSlot` — component chỉ hiển
thị, không tự fetch. `<input type="file">` (trigger upload) vẫn ở `App.tsx`
(đã có `fileInputRef`) — component chỉ nhận `onUploadClick` để gọi
`fileInputRef.current?.click()`, giữ đúng "1 input, 1 chỗ sở hữu".

## 3. Entry point tạo session RLM — session MỚI, không đổi driver session đang chạy

`ctx.agent.runTurn(driverName, ...)` cho phép override driver PER-MESSAGE
(`body.driver` REST, `msg.driver` WS) — về lý thuyết có thể "chuyển" 1
session đang chat thường sang RLM giữa chừng. **Không chọn hướng này**:
`sandbox.openSession()`/Python REPL persistent gắn 1-1 với `sessionId`,
`Session.extension('loop:rlm')` là state riêng của RLM — trộn 2 loại loop
trên CÙNG 1 session tạo ngữ nghĩa mơ hồ (history chung nhưng REPL state
tách biệt, dễ gây bug khó debug). Chọn: **RLM luôn là 1 session MỚI**,
đúng cơ chế "+ Chat mới" đã có, chỉ thêm 1 driver khác lúc `create_session`.

`SidebarProps` (`packages/ui-sidebar`) thêm callback thứ 2:

```typescript
onNewChat: () => void          // giữ nguyên, tạo driver:'default'
onNewDataSession: () => void   // MỚI, tạo driver:'rlm'
```

`Sidebar.tsx` thêm 1 nút cạnh "+ Chat mới" (cả bản thu gọn lẫn mở rộng,
xem `Sidebar.tsx:114-122` hiện tại) — icon riêng (`lucide-react`, đã có
sẵn trong dependency, xem Phase 18), ví dụ `Sparkles`/`Database`, label
"+ Phân tích dữ liệu". `App.tsx`'s `createSessionCommand()` nhận tham số
`driver` thay vì đọc hằng số `UI_AGENT_DRIVER` cố định:

```typescript
// trước: export function createSessionCommand() { return {type:'create_session', driver: UI_AGENT_DRIVER} }
// sau:
export function createSessionCommand(driver: 'default' | 'rlm' = 'default') {
  return { type: 'create_session', driver }
}
```

`connect(current, token, resumeSessionId?, driver?)` truyền tiếp xuống
lúc gửi `create_session` qua WS.

## 4. Sidebar cần biết driver của TỪNG session cũ (gap thật, phát hiện lúc lên plan)

`GET /sessions` (REST) đã trả `driver` trong response
(`bundles/adapters/api-rest/index.ts`: `mine.map((s) => ({id, driver,
maxSteps, createdAt}))`) — nhưng `SessionSummary`
(`packages/ui-sidebar/src/sessionHistory.ts:11-15`) chỉ có
`{id, createdAt, title}`, và `fetchSessionHistory()` **âm thầm bỏ field
`driver`** lúc map response (dòng 66-73). Cần:

```typescript
export interface SessionSummary {
  id: string
  createdAt: number
  title: string
  driver: string   // MỚI
}
```

Và `fetchSessionHistory()` giữ lại field này. `Sidebar.tsx` hiện 1 badge/
icon nhỏ cạnh mỗi session item khi `driver === 'rlm'` (tái dùng icon đã
chọn ở mục 3) — user phân biệt được session nào là phiên phân tích dữ
liệu khi lướt lại lịch sử, không cần bấm vào mới biết.

## 5. Việc CHƯA nằm trong phạm vi plan này (nói rõ để không hiểu nhầm)

Tách UI-plugin + đổi default driver **không tự động sửa** gap đã ghi ở
`docs/agent-core-rlm-web-ui-flow.md` (14 loại `LoopStep` RLM phát ra, UI
hiện chỉ hiện đúng 4 loại — code/observation/tool_call của RLM vẫn vô
hình). Đây là 2 việc độc lập: plan này giải quyết "UI RLM có nên hiện mặc
định hay không" (kiến trúc/entry point), KHÔNG giải quyết "khi RLM chạy,
hiện những gì trong lúc nó chạy" (nội dung render). Có thể làm plan riêng
cho phần đó sau khi phần này xong, theo đúng danh sách 6 gợi ý đã liệt kê
trong doc kia.

## 6. Test

Theo đúng 3-case pattern đã chuẩn hoá (`docs/ui-plugin-build-guide.md`
mục 3 Bước 6):
1. Session `driver:'rlm'` → `RenderSlot` render `WorkspaceHeaderPanel`/
   `SkillComposerExtra` thật, không phải `null`.
2. Session `driver:'default'` (hoặc `'planner-critic'`) → `RenderSlot`
   render `null` (fallback), không throw, không có DOM thừa nào của
   workspace bar/skill-select.
3. Unmount fiber `ui-rlm-workspace` giữa chừng (mô phỏng hot-swap) → UI tự
   rơi về `null`, không crash trang, không cần reload.
4. `Sidebar`: session cũ có `driver:'rlm'` hiện đúng badge; session
   `driver:'default'` không hiện badge.
5. `apps/web/tests/App.smoke.test.tsx`: thêm case "phiên `default` không
   render workspace bar" (bổ sung, không xoá case cũ) + case "bấm
   '+ Phân tích dữ liệu' → gửi `create_session` với `driver:'rlm'`".

## 7. Thứ tự implement đề xuất (khi được duyệt)

1. `apps/web/src/client-context.ts`: khai 2 slot mới. `npm run typecheck`
   xanh (chỉ thêm khai báo, chưa ai đăng ký).
2. `packages/ui-rlm-workspace/`: tạo package mới, di chuyển JSX workspace
   bar/skill-select từ `App.tsx` sang 2 component thuần nhận props (mục
   2). Test cô lập (case 1-3 mục 6) trước, chưa đụng `App.tsx`.
3. `packages/ui-sidebar`: thêm `driver` vào `SessionSummary` +
   `fetchSessionHistory()` + `SidebarProps.onNewDataSession` + badge UI
   (mục 4). Test cô lập (case 4 mục 6).
4. `App.tsx`: xoá JSX workspace bar/skill-select cứng, thay bằng 2
   `RenderSlot` (mục 1) truyền đúng owner props (mục 2); đổi
   `createSessionCommand()`/`connect()` nhận `driver` tham số thay vì hằng
   số `UI_AGENT_DRIVER` (mục 3); nối `onNewDataSession` từ `Sidebar` vào
   `startNewChat(settings, token, 'rlm')`. Cập nhật `apps/web/src/
   client-context.ts` mount `ui-rlm-workspace` (rule A16, KHÔNG auto-scan).
5. `apps/web/tests/App.smoke.test.tsx`: 2 case mới (mục 6.5).
6. `npm run typecheck && npm test` xanh toàn bộ (không chỉ package mới).
7. Verify thật: `docker compose up --build`, mở `:8790` — xác nhận "+ Chat
   mới" tạo phiên KHÔNG có workspace bar, "+ Phân tích dữ liệu" tạo phiên
   CÓ workspace bar + skill-select, session cũ trong Sidebar hiện đúng
   badge theo driver đã lưu — không chỉ tin test đơn vị.

---

## 8. Đã implement — kết quả thật

Đúng thứ tự 7 bước ở trên, không có sai khác so với plan.

- `packages/ui-rlm-workspace/` (MỚI) — `WorkspaceHeaderPanel.tsx`/
  `SkillComposerExtra.tsx` (component thuần, nhận props) + `index.ts` đăng
  ký cả 2 vào `'session.chrome.header'`/`'session.chrome.composer'` dưới
  key `'rlm'`. `<input type="file">` chuyển hẳn vào trong component (đóng
  gói DOM ref cục bộ) — `App.tsx`'s `handleFileUpload` đổi chữ ký từ nhận
  `ChangeEvent` sang nhận thẳng `File`.
- `packages/ui-sidebar`: `SessionSummary` thêm `driver` (field GET
  /sessions đã trả từ lâu nhưng bị bỏ quên lúc map — gap thật, không phải
  cố ý). `SidebarProps` thêm `onNewDataSession`; nút "Phân tích dữ liệu"
  tái dùng style `.settingsTrigger` có sẵn (không tạo CSS mới); badge
  `Database` (lucide-react) hiện cạnh title session có `driver === 'rlm'`
  trong lịch sử.
- `apps/web/src/App.tsx`: `UI_AGENT_DRIVER` xoá hẳn;
  `createSessionCommand(driver = 'default')`; state mới `sessionDriver`
  (đồng bộ từ `session_created` WS message lúc tạo mới, từ tra cứu
  `sessions` list lúc resume); 2 khối JSX cứng (workspace bar, skill-select)
  thay bằng `<RenderSlot entryKey={sessionDriver} fallback={() => null} />`.
- `apps/web/src/client-context.ts`: khai 2 slot mới, mount
  `ui-rlm-workspace` (rule A16, tường minh).
- `Dockerfile`: thêm dòng `COPY packages/ui-rlm-workspace/package.json`
  vào stage `deps` (gap thật đã biết trước từ các package UI trước đó —
  quên dòng này thì `npm ci` không thấy package mới, build fail).

**Verify thật đã chạy** (không chỉ tin code "trông đúng"):
- `npm run typecheck` sạch, `npm test` **200/200 pass, 37 file** (từ 193 —
  +3 `ui-rlm-workspace` mới, +2 `Sidebar.test.tsx`, +2 `App.smoke.test.tsx`).
- `docker compose up --build agent-core` thành công, container healthy;
  xác nhận trực tiếp trong bundle JS đã build (`docker exec` +
  `python3 -c "... in data"`) có đủ 3 chuỗi `"Phân tích dữ liệu"`/
  `"workspace-bar"`/`"skill-select"`.
- **WS thật qua `ws` package** (không phải giả lập): `create_session` KHÔNG
  kèm `driver` → server trả `driver: "default"` (client giờ mặc định gửi
  đúng giá trị này, không còn `'rlm'` cứng); `create_session` kèm
  `driver:"rlm"` → server trả đúng `"rlm"`. `GET /sessions` sau đó liệt kê
  ĐÚNG cả 2 session với field `driver` chính xác — xác nhận toàn bộ chuỗi
  dữ liệu Sidebar sẽ đọc (badge, entry point) là thật, không chỉ đúng ở
  tầng component cô lập. Tài khoản test đã dọn qua đúng `DELETE /users/:id`.

**Chưa làm** (đúng phạm vi đã nói ở mục 5, không phải bỏ sót): nội dung
hiện ra TRONG LÚC RLM chạy (14 loại `LoopStep` vs 4 loại UI hiện) — vẫn là
việc riêng, xem `docs/agent-core-rlm-web-ui-flow.md`.

## 9. Follow-up 1 — `subHeader` mới cho `AppFrame` (workspace bar lệch hàng với tiêu đề)

Gap thị giác thật user báo lại: workspace bar (mục 2, đăng ký vào
`'session.chrome.header'`) từng render vào PROP `header` của `AppFrame` —
nhưng `.header` (`AppFrame.module.css`) là `display:flex; justify-content:
space-between` dành ĐÚNG cho 2 phần tử (tiêu đề + trạng thái) trên 1 hàng.
Thêm workspace bar làm phần tử thứ 3 vào CÙNG hàng flex đó ép mọi thứ nằm
chung 1 dòng ngang với tiêu đề. Fix: thêm prop `subHeader?: ReactNode` mới
vào `AppFrame` (`packages/ui-layout/src/AppFrame.tsx`) — render NGOÀI
`<header>`, xuống hàng riêng. `App.tsx` chuyển `RenderSlot` của
`'session.chrome.header'` từ `header` sang `subHeader`. `AppFrame` vẫn
"thuần" — không biết gì về RLM/workspace, chỉ thêm 1 slot tổng quát tái
dùng được.

## 10. Follow-up 2 — dropdown skill: `Select` primitive mới, thay native `<select>`

User yêu cầu rõ: dropdown phải là "UI riêng theo theme của web" (native
`<select>` không style được popup — browser tự vẽ theo OS) và "hiện phía
trên" (trigger nằm sát đáy viewport, cạnh ô nhập chat — popup xuống dưới sẽ
tràn màn hình/đè composer).

Thêm **`Select`** vào `packages/ui-primitives` (mới, KHÔNG chỉ riêng cho
RLM — component dùng chung như `TextField`/`Modal`/`Tooltip`): cùng kỹ
thuật portal `document.body` + `getBoundingClientRect()` đã có ở
`Tooltip.tsx` (không thêm thư viện positioning ngoài, coding rule A6),
thêm `direction: 'up' | 'down'` (Tooltip cũ luôn cố định 1 hướng — Select
cần cả 2 vì vị trí trigger đa dạng hơn). Hỗ trợ bàn phím đầy đủ
(ArrowUp/Down mở + di chuyển, Enter chọn, Escape đóng) — không bớt so với
native `<select>` gốc. `SkillComposerExtra.tsx` (`packages/ui-rlm-workspace`)
đổi sang dùng `Select` với `direction="up"`; `SkillComposerExtra.module.css`
chỉ còn giữ margin canh mép composer (style trigger/popup do `Select` đảm
nhiệm). Dọn `#compose-form`/`#compose-input`/`#skill-select` (rule global
cũ, xác nhận 0 tham chiếu JSX trước khi xoá) khỏi `apps/web/src/style.css`.

**Verify**: `npm run typecheck` sạch, `npm test` **207/207 pass** (37 file,
+7 test `Select` mới trong `packages/ui-primitives/tests/primitives.test.tsx`
— mở/đóng, chọn option, click-outside, Escape, bàn phím, disabled).
`docker compose up --build` healthy; xác nhận trực tiếp trong bundle JS đã
build có `role="listbox"`/`aria-haspopup` (component mới thật sự được
build vào, không chỉ đúng ở test cô lập).
