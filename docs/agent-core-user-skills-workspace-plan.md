# Plan: "Các kỹ năng" — user-authored skill workspace (tham khảo ChatGPT Skills)

## 0. Bối cảnh & tham khảo

Yêu cầu: thêm 1 nút sidebar tên **"Các kỹ năng"**, đặt ngay dưới nút **"Chat
mới"** — cùng hàng/kiểu với nút **"Phân tích dữ liệu"** hiện có (mở
`ProjectHub`). Bấm vào mở ra 1 "không gian làm việc" (workspace) nơi **user tự
tạo, sửa, xoá, quản lý các file skill `.md`** của chính họ — không cần biết
Cordis/TypeScript, không cần deploy lại.

Tham khảo hành vi: [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)
(trang này chặn fetch trực tiếp — 403 — nên tổng hợp từ search + các bài mô tả
tính năng: [OpenAI Academy — Using skills](https://openai.com/academy/skills/),
[How to Create a ChatGPT Skill (2026)](https://www.aiagentslibrary.com/blog/how-to-create-a-chatgpt-skill/),
[ChatGPT Skills Are Here](https://theaicareerlab.com/blog/chatgpt-skills-what-they-are-how-to-enable-2026)).
Tóm tắt các điểm liên quan trực tiếp tới thiết kế:

- 1 skill = 1 file `SKILL.md` với YAML frontmatter tối thiểu `name` +
  `description`, theo sau là nội dung hướng dẫn dạng Markdown. Package skill
  còn có thể có `scripts/`, `references/`, `assets/` đi kèm.
- 3 cách tạo: **Create with chat** (nhờ chính trợ lý soạn ngay trong hội
  thoại), **Create with editor** (form: tên, mô tả/điều kiện kích hoạt,
  instructions từng bước, output format, ví dụ, resource đính kèm), **Upload**
  (tải lên 1 package đã soạn sẵn).
- Quản lý: liệt kê trong 1 khu vực riêng (ChatGPT đặt ở Plugins → Skills),
  sửa lại bất kỳ lúc nào qua editor, download.
- **Không kích hoạt thủ công** — trợ lý tự nhận diện lúc nào skill liên quan
  dựa trên `name`+`description`, người dùng không cần bật/tắt mỗi lượt chat.
- Phạm vi hiển thị: mặc định riêng tư (private) cho người tạo; có thể chia sẻ
  người khác/nhóm hoặc publish cho cả workspace nếu admin cho phép — **phần
  chia sẻ/publish nằm ngoài scope yêu cầu lần này** (chỉ nói "quản lý của
  user"), ghi nhận ở mục 8 (Ngoài phạm vi) để làm sau nếu cần.

**Tin tốt**: format `SKILL.md` + `{assets,references,scripts,templates}/` mà
ChatGPT dùng **trùng gần như 100%** với format agent-core đã tự xây dựng từ
trước (`bundles/skills/<name>/SKILL.md`, xem
`bundles/providers/skill-filesystem/index.ts`). Không cần phát minh format
mới — chỉ cần thêm 1 nguồn skill THỨ HAI (do user tự quản lý qua UI, lưu theo
user, sửa được lúc chạy) bên cạnh nguồn tĩnh hiện tại (do dev mount lúc boot,
đọc từ `bundles/skills/`, không sửa được lúc chạy).

## 1. Đọc lại kiến trúc skill hiện tại (để biết chỗ nào tái dùng được, chỗ nào phải thêm mới)

| Thành phần | Vai trò hiện tại | Giới hạn cho use case mới |
|---|---|---|
| `seams/skill.ts` (`SkillRegistryService`) | Catalog TĨNH, `register()` **throw nếu trùng tên**, tháo qua `ctx.effect()` gắn với fiber plugin — đúng model "dev mount skill lúc boot, hot-swap được nhờ Cordis, nhưng KHÔNG có `update()`/CRUD nào cho registry" | Không có khái niệm "chủ sở hữu" (ownerId), không hỗ trợ sửa/xoá runtime theo yêu cầu người dùng cuối |
| `bundles/providers/skill-filesystem` | Quét 1 thư mục (`bundles/skills/`) **1 LẦN lúc `apply()`**, đăng ký mỗi `SKILL.md` tìm được vào `ctx.skills` | Quét 1 lần, không watch file, không tách theo user — không dùng trực tiếp được cho skill do user tạo lúc runtime |
| `src/skill-runtime.ts` (`resolveActiveSkills`, `skillCatalogGuidance`) | Match trigger tất định + dựng catalog (name+description) chèn vào system prompt, bảo model tự gọi tool `skill` nếu thấy hợp | Chỉ đọc từ 1 `SkillRegistryService` duy nhất — cần mở rộng để gộp thêm nguồn skill riêng của user đang chat |
| `bundles/providers/skill-selection-llm` | 1 lượt gọi LLM riêng, chọn tối đa 1 skill từ danh sách candidate (gate ngữ nghĩa, không phải model chính) | Nhận `candidates` từ ngoài truyền vào — không cần sửa, chỉ cần nơi gọi nó gộp đủ candidate (system + user) |
| `bundles/tools/tool-skill` (`skill`, `read_skill_resource`) | Model tự gọi để nạp full instructions/đọc resource — đọc thẳng `ctx.skills.get()/readResource()` | Cần biết đang chạy cho user nào để nạp được skill RIÊNG của user đó, không chỉ skill hệ thống |
| `seams/tools.ts` (`ToolInvocationContext`) | Có sẵn field `principal?: string` — khai báo nhưng **chưa từng được set ở đâu** (xác nhận qua grep repo-wide) | Cần chính thức hoá: set `ownerId` thật từ `session.ownerId` lúc gọi tool, `tool-skill` đọc field này |
| `ctx.workspace` (`workspace-local`/`workspace-docker`) + `handleWorkspaceFiles` (api-rest) | Đã có sẵn read/write/list/delete file theo `workspaceId` bất kỳ (đang dùng cho `session:<id>` và `project:<id>`) | Tái dùng được cho `user-skills:<ownerId>`, chỉ cần thêm 1 nhánh trong `workspaceParts()` (xem mục 2) |

**Quyết định kiến trúc (sau khi bàn lại — gộp thay vì tách)**: bản nháp đầu
tiên của plan này định tạo hẳn 1 seam song song (`seams/user-skills.ts`) —
**thừa**. Đếm lại số nơi thật sự gọi `ctx.skills.get/list/match` trong repo
(`tool-skill`, `loop-default`, `loop-rlm`, `loop-planner-critic` — đúng 6 chỗ)
thì thấy: nếu tách seam riêng, MỌI nơi trong số đó phải tự fetch cả 2 registry
rồi tự merge, còn phải làm `ctx.get('userSkills')` kiểu soft-dependency dù đây
không phải tính năng tuỳ chọn. Gộp thẳng vào **cùng 1 seam/provider hiện có**
(`seams/skill.ts` / `bundles/providers/skill-registry`) rẻ hơn và đúng hơn:
- 6 method **cũ giữ nguyên signature** (`register/get/has/list/match/readResource`)
  — không đổi gì cho skill hệ thống, rủi ro = 0.
- Thêm method **mới, đặt tên rõ hậu tố `Owned`**, cùng class, async (khác 4
  method cũ đang sync vì đọc Map in-memory — không gộp chung 1 method vì sẽ
  buộc mọi call site cũ phải thêm `await` dù chỉ cần skill hệ thống, một thay
  đổi lan rộng không cần thiết):
  `listOwned/getOwned/matchOwned/createOwned/updateOwned/removeOwned/read|write|deleteOwnedResource`.
- `bundles/providers/skill-registry` thêm `inject: ['workspace']` — implementation
  của các method `*Owned` bên trong CHÍNH class `SkillRegistry` đọc/ghi qua
  `ctx.workspace`, còn 6 method cũ vẫn dùng Map in-memory như trước, không
  đụng nhau.

Kết quả: đúng "1 cục" cho phần skill/storage (1 seam, 1 provider, 1 `ctx.skills`
object) — không có seam thứ 2, không có `ctx.get()` tuỳ chọn nào cho tính năng
lẽ ra luôn bật.

## 2. Mở rộng `seams/skill.ts` + `bundles/providers/skill-registry`

```ts
// seams/skill.ts — thêm vào SkillRegistryService hiện có, KHÔNG đổi 6 method cũ
export interface OwnedSkillDefinition extends SkillDefinition {
  ownerId: string
  slug: string        // định danh bất biến trong URL/tool-call — name hiển thị đổi được, slug thì không
  createdAt: string
  updatedAt: string
}

// ... abstract class SkillRegistryService extends Service {
//   (giữ nguyên register/get/has/list/match/readResource)
abstract listOwned(ownerId: string): Promise<OwnedSkillDefinition[]>
abstract getOwned(ownerId: string, slug: string): Promise<OwnedSkillDefinition | undefined>
abstract createOwned(ownerId: string, input: { name: string; description: string; instructions: string }): Promise<OwnedSkillDefinition>
abstract updateOwned(ownerId: string, slug: string, input: { description?: string; instructions?: string }): Promise<OwnedSkillDefinition>
abstract removeOwned(ownerId: string, slug: string): Promise<void>
abstract matchOwned(ownerId: string, userMessage: string): Promise<OwnedSkillDefinition[]>
abstract readOwnedResource(ownerId: string, slug: string, resourcePath: string): Promise<SkillResourceContent>
abstract writeOwnedResource(ownerId: string, slug: string, resourcePath: string, content: Buffer): Promise<SkillResource>
abstract deleteOwnedResource(ownerId: string, slug: string, resourcePath: string): Promise<void>
// }
```

Thiết kế **read-through, không cache riêng**: mọi method `*Owned` đọc thẳng
`ctx.workspace` mỗi lần gọi (giống cách `handleWorkspaceFiles` đang làm cho
project files) — đơn giản hơn hẳn việc tự dựng thêm 1 tầng cache phải tự lo
invalidate, và số skill của 1 user không đủ lớn để việc đọc file mỗi lần gây
vấn đề hiệu năng thật.

**Vì sao KHÔNG tái dùng đúng cơ chế `register()`/Map in-memory cho cả skill
user**: skill hệ thống gắn với fiber plugin (tháo khi dev disable bundle,
KHÔNG persist qua restart — luôn quét lại từ `bundles/skills/` lúc boot), còn
skill user gắn với **account**, phải sống sót qua restart mà không cần "quét
lại thư mục" nào (số lượng/thời điểm tạo là bất kỳ, không thể biết trước lúc
boot) → bắt buộc có 1 tầng đọc/ghi file thật (`ctx.workspace`) phía sau, khác
hẳn Map in-memory của `register()`. Đây là lý do 2 NHÓM method khác nhau tồn
tại trong CÙNG 1 class, không phải lý do để tách thành 2 seam.

`workspaceId` quy ước: `` `user-skills:${ownerId}` ``. **Lưu ý xác nhận lúc
đọc code** (không phải giả định): `workspaceParts()` trong
`bundles/providers/workspace-local/index.ts` hiện CHỈ đặc cách tiền tố
`project:` (map sang `projects/<id>/`) — mọi chuỗi khác bị coi là 1 tên thư
mục phẳng, nằm chung hàng với session workspace thật. Cần thêm đúng 1 nhánh
`user-skills:` (song song nhánh `project:`) trong `workspaceParts()` — ở CẢ
`workspace-local` lẫn `workspace-docker` — để skill của user rơi vào
`user-skills/<ownerId>/` gọn gàng, và xác nhận `safeSessionId()` chấp nhận ký
tự `:` trong giá trị truyền vào (hoặc strip tiền tố trước khi gọi nó, giống
cách nhánh `project:` đang làm).

Cấu trúc file trong workspace đó — **giống hệt** `bundles/skills/<name>/`:
```
<slug>/SKILL.md
<slug>/references/...
<slug>/scripts/...
<slug>/assets/...
<slug>/templates/...
```

- `createOwned()`: validate `name` non-empty → tự sinh `slug` (kebab-case hoá
  `name`) → check trùng: (a) trùng slug hiện có CỦA CHÍNH user đó (tự thêm hậu
  tố `-2`, `-3`...), (b) trùng tên với **skill hệ thống** (đọc `this.list()`
  method cũ, cùng class nên gọi trực tiếp `this.`, không cần `ctx.skills.`) —
  chặn cứng nếu trùng để tránh model nạp nhầm skill khi gọi tool `skill` bằng
  tên → dựng nội dung `SKILL.md` (frontmatter `name`/`description`/`triggers`
  rỗng mặc định + `instructions` body) → ghi qua `ctx.workspace.writeFile()`.
- `updateOwned()`: đọc lại `SKILL.md`, merge field đổi, ghi đè. **`slug` bất
  biến sau khi tạo** (đổi tên hiển thị được qua frontmatter `name`, không đổi
  slug — tránh vỡ link resource/tool-call đang tham chiếu slug cũ).
- `removeOwned()`: xoá cả thư mục `<slug>/` (đệ quy) qua `ctx.workspace`.
- `matchOwned()`: tái dùng NGUYÊN VẸN thuật toán regex trigger-boundary hiện
  có trong `match()` — tách phần lõi ra 1 hàm private dùng chung cho cả 2
  method trong cùng class, không chép lại logic.

## 3. Gộp vào pipeline kích hoạt skill (điểm chạm quan trọng nhất)

Nguyên tắc: **từ góc nhìn model, không có khái niệm "skill hệ thống" vs "skill
của tôi"** — đúng tinh thần ChatGPT (không phân biệt nguồn, chỉ có 1 danh sách
skill khả dụng). Chỉ khác ở chỗ ai được sửa/xoá.

- `src/skill-runtime.ts`:
  - `resolveActiveSkills()` nhận thêm tham số `ownedSkills: OwnedSkillDefinition[]`
    (đã fetch sẵn bằng `ownerId` trước khi gọi) — trigger-match cả 2 nguồn,
    gộp kết quả.
  - `skillCatalogGuidance()` nhận catalog đã gộp sẵn (system + owned), không
    cần biết nguồn nào — model thấy 1 `<skill_catalog>` duy nhất.
- `bundles/loop-drivers/loop-default/index.ts` (và `loop-rlm/protocol.ts`,
  `loop-planner-critic` nếu áp dụng): trước khi build prompt, khi
  `session.ownerId` tồn tại thì gọi thêm
  `await runCtx.skills.listOwned(session.ownerId)` — **không cần `ctx.get()`
  tuỳ chọn nữa** (khác bản nháp trước) vì `skill-registry` là provider LUÔN
  mount, không phải seam tuỳ chọn kiểu `ctx.memory` — rồi truyền cả 2 danh
  sách vào `resolveActiveSkills`/`skillCatalogGuidance`.
- `bundles/providers/skill-selection-llm`: **không sửa** — nó chỉ nhận
  `candidates` từ ngoài, nơi gọi nó (loop-default) chịu trách nhiệm gộp trước
  khi truyền vào.
- `bundles/tools/tool-skill`:
  - `seams/tools.ts`'s `ToolInvocationContext` thêm field chính thức:
    `ownerId?: string` (thế chỗ cho `principal` đang bỏ hoang — cân nhắc dùng
    lại đúng field `principal` thay vì thêm field mới nếu ngữ nghĩa gốc của nó
    đúng là "danh tính người gọi"; quyết định cụ thể lúc code, không phải lúc
    plan).
  - Nơi thực thi tool call (trong `loop-default`, chỗ build
    `ToolInvocationContext`) set field này = `session.ownerId`.
  - Handler `skill`/`read_skill_resource`: thử `ctx.skills.get(name)` trước
    (skill hệ thống) → không thấy thì thử
    `await ctx.skills.getOwned(context.ownerId ?? '', name)` (skill riêng của
    đúng user đang chat) → không thấy ở cả 2 mới báo lỗi "not found".

**Vì sao đây là điểm khó nhất, không phải điểm phụ**: nếu bỏ sót
`ToolInvocationContext.ownerId`, model VẪN thấy skill của user trong catalog
(qua `skillCatalogGuidance`) nhưng gọi tool `skill` để nạp full instructions
sẽ luôn thất bại — bug im lặng kiểu "catalog nói có, tool nói không" rất khó
phát hiện nếu không test đúng kịch bản end-to-end (nạp 1 owned-skill thật giữa
1 turn, không chỉ test riêng CRUD).

## 5. REST API (`bundles/adapters/api-rest`)

Theo đúng style ownership-based đã có cho `/sessions`, `/projects` (không cần
RBAC action mới — mọi user đã đăng nhập được tự quản skill CỦA CHÍNH họ,
giống sở hữu session/project, không phải hành động admin):

| Method | Path | Việc | Gọi seam |
|---|---|---|---|
| GET | `/skills/mine` | Liệt kê skill của `identity.userId` | `ctx.skills.listOwned(userId)` |
| POST | `/skills/mine` | Tạo mới — body `{ name, description, instructions }` | `ctx.skills.createOwned(userId, body)` |
| GET | `/skills/mine/:slug` | Đọc 1 skill (kèm resource list) | `ctx.skills.getOwned(userId, slug)` |
| PATCH | `/skills/mine/:slug` | Sửa `description`/`instructions` | `ctx.skills.updateOwned(userId, slug, body)` |
| DELETE | `/skills/mine/:slug` | Xoá cả package | `ctx.skills.removeOwned(userId, slug)` |
| GET/POST/DELETE | `/skills/mine/:slug/files(/:path)` | Resource — tái dùng THẲNG `handleWorkspaceFiles` với `workspaceId = user-skills:<userId>` giống hệt cách `/projects/:id/files` đang làm, gần như copy-paste route matcher | `ctx.workspace.*` trực tiếp (giống route project files) |

Toàn bộ route check `session`/`skill` thuộc về `identity.userId` trước khi
đọc/ghi — không có middleware "admin bypass" (khác `/users`) vì đây là dữ liệu
cá nhân thuần tuý.

## 6. Frontend — build như 1 UI-plugin qua `ui-slots`, không viết cứng vào App.tsx

**Sửa lại quyết định so với bản nháp đầu** (phát hiện lúc bàn với user, không
phải giả định ban đầu): `packages/ui-slots`/`ctx.slots` (cây Cordis riêng
trong trình duyệt, `apps/web/src/client-context.ts`) là 1 slot registry
**tổng quát** — `declare(name, kind)` nhận tên bất kỳ, KHÔNG chỉ dành cho
`tool.call.toolview`. Bằng chứng: `client-context.ts` hiện đã khai thêm 2 slot
nữa (`session.chrome.header`, `session.chrome.composer`, cả 2 kind `'keyed'`)
mà `ui-rlm-workspace` dùng để chèn "workspace bar/skill-select" của RLM vào
`App.tsx` **mà không cần App.tsx viết cứng gì cho RLM** — `App.tsx` chỉ gọi
`RenderSlot<WorkspaceHeaderPanelProps> name="session.chrome.header"` và
tự rơi về `null` nếu không có registrant khớp key. Đây CHÍNH LÀ pattern nên
dùng cho "Các kỹ năng", thay vì thêm prop `onOpenSkills`/state `skillsView`
viết tay vào `Sidebar.tsx`/`App.tsx` như bản nháp đầu.

**Giới hạn thật cần biết trước** (không đổi so với backend): `client-context.ts`
import các UI-plugin bằng **static import** (`import * as uiRlmWorkspace from
'@agent-core/ui-rlm-workspace'`), khác cơ chế `import()` runtime của
`EXTRA_PLUGINS` phía backend — thêm 1 UI-plugin (kể cả first-party) luôn cần
thêm dependency vào `apps/web/package.json` + rebuild (`npm run build:web`),
không có đường "drop-in không rebuild" nào cho frontend. Không phải hạn chế
riêng cho bên thứ 3 — mọi UI-plugin đều vậy, kể cả `ui-rlm-workspace` hiện tại.

### 6.1 Slot mới cần khai (`apps/web/src/client-context.ts`)

```ts
ctx.slots.declare('sidebar.action', 'list')   // nút phụ dưới "Phân tích dữ liệu" — nhiều plugin có thể góp 1 nút
ctx.slots.declare('workspace.page', 'keyed')  // trang toàn màn hình thay composer/chat, key = id trang (vd. 'skills')
```

Cùng file, thêm dòng mount UI-plugin mới, đúng pattern `uiRlmWorkspace`:
```ts
const uiSkillsFiber = ctx.plugin(uiSkills)
await uiSkillsFiber.await()
```

### 6.2 Package mới `packages/ui-skills` — 1 UI-plugin thật, không phải thành phần viết tay trong App.tsx

Mirror đúng shape `packages/ui-rlm-workspace` (package.json, `index.ts` với
`export const apply = (ctx) => { ctx.slots.register('sidebar.action', {...}); ctx.slots.register('workspace.page', { key: 'skills', ... }) }`,
disposer gắn qua `ctx.effect()` — coding rule A15 áp dụng cả UI-plugin, xem
comment gốc ở `SlotRegistryService.register`):

- Đăng ký vào `sidebar.action`: 1 entry render nút "Các kỹ năng" (icon
  `Puzzle`/`Sparkles`, cùng pattern `Tooltip`+`Button variant="ghost"` lúc
  collapsed / label đầy đủ lúc mở như nút "Phân tích dữ liệu" hiện có) — nhận
  props tối thiểu `{ collapsed: boolean; onClick: () => void }`, `Sidebar.tsx`
  tự quyết `onClick` sẽ mở `workspace.page` key `'skills'` bằng state cục bộ
  của `App.tsx` (giữ đúng nguyên tắc "Sidebar không biết logic điều hướng",
  chỉ `App.tsx` biết) — **KHÔNG cần thêm prop `onOpenSkills` cứng vào
  `Sidebar.tsx`**, chỉ cần 1 `RenderSlot(clientCtx, 'sidebar.action', {...})`
  chung, tương tự cách `session.chrome.*` không cần prop riêng cho từng driver.
- Đăng ký vào `workspace.page` (key `'skills'`): `SkillsWorkspace.tsx` —
  **nội dung UI giữ nguyên như bản nháp đầu** (list view + editor view, xem
  chi tiết field bên dưới), chỉ khác chỗ NÓ ĐƯỢC MOUNT — qua slot thay vì
  `App.tsx` tự `import` và render trực tiếp.
  - **List view**: card mỗi skill (tên, mô tả, cập nhật lúc nào, số resource
    file) + nút **"Tạo kỹ năng mới"** + ô tìm kiếm theo tên.
  - **Editor view**: Tên (bắt buộc) → sinh slug gợi ý; Mô tả/"Khi nào nên
    dùng skill này" (bắt buộc — field model dùng để tự quyết định nạp skill,
    cần chú thích rõ trong UI đây là field quan trọng nhất); Nội dung hướng
    dẫn (textarea Markdown, có thể tái dùng `AssistantMarkdown` từ
    `ui-conversation` để preview); Panel resource theo 4 nhóm
    (references/scripts/assets/templates), upload/xoá từng file (tham khảo
    style upload của `ui-rlm-workspace`, không bắt buộc dùng lại code); nút
    Lưu/Xoá/Quay lại danh sách.
- Mount trong `AppFrame` với `wide` (prop đã có sẵn, đang dùng cho
  `ProjectHub`).

### 6.3 `App.tsx`

Thêm 1 state cục bộ tối thiểu (vd. `activeWorkspacePage: string | null`) để
biết đang hiện `workspace.page` key nào (hoặc composer/chat bình thường nếu
`null`) — **không cần biết "skills" là gì cụ thể**, chỉ cầm key string truyền
xuống `RenderSlot(clientCtx, 'workspace.page', activeWorkspacePage, {...})`.
Đây chính là tinh thần "App.tsx không viết cứng cho từng tính năng" mà
`session.chrome.*` đã chứng minh chạy được cho RLM.

### 6.4 Vì sao đáng làm theo hướng này thay vì viết cứng (như bản nháp đầu)

- **Nhất quán** với cách `ui-rlm-workspace`/`ui-tool-web-search` đã tích hợp —
  không có 2 cách làm UI-plugin song song trong cùng codebase.
- **Thật sự pluggable**: nếu sau này 1 bundle khác (kể cả bên thứ 3, miễn được
  thêm vào build) muốn góp thêm 1 nút sidebar/1 trang workspace khác, chỉ cần
  đăng ký vào 2 slot NÀY, không cần sửa `Sidebar.tsx`/`App.tsx` thêm lần nào
  nữa — đúng câu hỏi gốc "bên thứ 3 build khác cấu trúc thế nào": với 2 slot
  này tồn tại, phần UI của họ KHÔNG còn khác cấu trúc first-party nữa (chỉ còn
  khác ở việc REST route vẫn chưa có cơ chế đăng ký — xem ghi chú cuối mục 8).

## 7. Quy tắc đặt tên & tránh trùng

- `name` do user nhập tự do (tiếng Việt có dấu OK, hiển thị trong UI).
- `slug` sinh tự động (lowercase, bỏ dấu, thay khoảng trắng bằng `-`,
  lowercase kebab — cùng convention thư mục các skill hệ thống đang dùng như
  `business-case-builder`).
- Trùng `slug` trong phạm vi 1 user → tự thêm hậu tố `-2`, `-3`... (không chặn
  cứng, vì đây là trải nghiệm tự phục vụ, không nên bắt user tự nghĩ tên khác
  ngay lúc gõ).
- Trùng với **tên skill hệ thống** → chặn cứng + thông báo rõ ("tên này đã
  được dùng bởi skill có sẵn của hệ thống, chọn tên khác") — vì đây là
  namespace CHIA SẺ thật ở bước tool-call `skill(name)`, không âm thầm merge
  được.

## 8. Ngoài phạm vi lần này (ghi nhận để làm sau nếu cần)

- Chia sẻ skill giữa các user / publish "workspace-wide" (ChatGPT có, yêu cầu
  hiện tại chỉ nói "quản lý của user" — số ít).
- "Create with chat" — 1 tool mới (vd. `create_skill`/`update_skill`) để
  chính trợ lý soạn/sửa skill ngay trong hội thoại thay vì qua form. 9 method
  `*Owned` thêm vào `ctx.skills` ở mục 2 đã đủ để thêm tool này sau mà không
  cần đổi gì — chỉ là 1 `bundles/tools/tool-user-skill` mới bọc quanh chúng.
- Upload nguyên 1 package dạng zip (MVP chỉ cần soạn trực tiếp trong editor +
  đính kèm resource file rời).
- Admin xem/quản lý skill của toàn bộ user (không có yêu cầu này).
- **REST route registration cho bên thứ 3** (câu hỏi "nếu bên thứ 3 build thì
  khác thế nào" đặt ra khi bàn plan này): `api-rest` hiện là 1 chuỗi if/else
  cứng trong 1 file core, KHÔNG có cơ chế nào cho 1 Cordis plugin ngoài
  (`EXTRA_PLUGINS`) tự đăng ký thêm route HTTP. Khác UI (đã pluggable qua
  `ctx.slots`, xem mục 6.4) và tool/prompt (`ctx.tools.add`/`ctx.prompts.section`
  đã pluggable từ trước) — đây là extension point THẬT SỰ còn thiếu, tổng
  quát cho MỌI plugin cần route riêng chứ không riêng skill. Ngoài phạm vi
  "Các kỹ năng", ghi nhận làm hạng mục riêng nếu sau này cần bên thứ 3 tự
  expose REST API của họ qua đúng port/domain agent-core đang chạy.

## 9. Thứ tự implement đề xuất

1. `workspaceParts()` thêm nhánh `user-skills:` trong `workspace-local` +
   `workspace-docker` (nền tảng bắt buộc trước, cả 2 provider).
2. Mở rộng `seams/skill.ts` (thêm `OwnedSkillDefinition` + 9 method `*Owned`)
   và `bundles/providers/skill-registry` (thêm `inject: ['workspace']` +
   implementation) — test riêng (CRUD + resource file qua `ctx.skills.*Owned`
   trực tiếp, không đụng gì tới loop/tool trước; xác nhận 6 method cũ không
   đổi hành vi qua test hiện có).
3. Route REST `/skills/mine*` trong `api-rest` + test HTTP thật (giống style
   test `/projects/*` đã có).
4. Gộp vào pipeline kích hoạt: `ToolInvocationContext.ownerId`,
   `resolveActiveSkills`/`skillCatalogGuidance` nhận thêm nguồn owned,
   `tool-skill` thử cả 2 nguồn — test end-to-end thật (1 user tạo skill qua
   REST, gửi tin nhắn khớp trigger/description, xác nhận model nạp được đúng
   skill đó qua tool `skill`).
5. `packages/ui-skills` (list + editor) + test component.
6. `Sidebar`/`App.tsx` wiring nút mới.
7. `npm run typecheck && npm test` xanh toàn bộ, cập nhật
   `docs/frontend-backend-handoff.md`/`docs/system-architecture.md` (thêm
   9 method mới vào mục mô tả `seams/skill.ts`, giống cách `seams/projects.ts`
   đã được thêm vào 2 file đó).
8. Docker E2E thật: tạo skill qua REST, chat khớp trigger, xác nhận tool
   `skill` nạp đúng nội dung — không chỉ tin vào unit test mock.

## Sources
- [Skills in ChatGPT — OpenAI Help Center](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)
- [Using skills — OpenAI Academy](https://openai.com/academy/skills/)
- [How to Create a ChatGPT Skill in 2026](https://www.aiagentslibrary.com/blog/how-to-create-a-chatgpt-skill/)
- [ChatGPT Skills Are Here: What They Are, Who Gets Them, and How to Enable Them at Work](https://theaicareerlab.com/blog/chatgpt-skills-what-they-are-how-to-enable-2026)
