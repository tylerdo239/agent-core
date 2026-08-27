# Plan — Skill do user tự thêm: upload file `.md`, quản lý qua UI (nút "Kỹ năng") — ĐÃ IMPLEMENT, ĐÃ VERIFY qua Docker

## 0. Bối cảnh, quyết định phạm vi

User hỏi "plan docs đã plan nút Kỹ năng cho user tự add file md + UI quản lý đâu rồi" — đã audit toàn bộ `docs/` (19 file) + `apps/web/src/App.tsx`: **không tồn tại** plan nào cho việc này. Cái đang có chỉ là dropdown "Chọn skill" (`SkillComposerExtra.tsx`) để CHỌN 1 skill có sẵn — skill mới hiện chỉ thêm được bằng cách developer tạo `bundles/skills/<name>/SKILL.md`, `skill-filesystem` quét lúc **boot** container (`docs/system-architecture.md` mục "Thêm skill"). Không có route ghi, không có UI quản lý. Đây là plan MỚI cho tính năng chưa từng được thiết kế.

**Quyết định phạm vi (đã chốt với user)**: skill user tự thêm là **riêng từng user** — mỗi user thường tự thêm/sửa/xoá skill của mình, chỉ áp dụng cho session của chính họ; admin xem/quản lý được tất cả (kiểm duyệt). Lý do chọn nhánh này thay vì "chỉ admin, dùng chung" (giống hệt pattern `ctx.pluginConfig`/"Cấu hình" hiện có): nội dung skill chèn thẳng vào system prompt của **chính session của người tạo ra nó** — rủi ro prompt-injection không tăng so với việc user vốn đã tự gõ thẳng instruction vào tin nhắn của họ. Khác hẳn `pluginConfig` (secret dùng chung toàn hệ thống, mọi user), nên không dùng lại y nguyên pattern đó.

## 1. Vì sao không tái dùng nguyên trạng `ctx.skills.register()`

`SkillRegistry.register()` (`bundles/providers/skill-registry/index.ts`) gắn effect qua `this.ctx.effect()` — skill tự gỡ khi FIBER GỌI `register()` unload. Đúng cho `skill-filesystem`/`skill-support-tone` (gọi từ fiber `apply()` của chính plugin, sống suốt vòng đời app). Nhưng vòng đời skill user-upload gắn với **CRUD qua Postgres**, không gắn với 1 fiber plugin cụ thể nào — nếu gọi `register()` trực tiếp từ trong request handler của `api-rest`, hành vi dispose phụ thuộc fiber nào đang giữ `ctx` ở đó (không rõ ràng, chưa từng có precedent nào trong repo dùng effect-scoping theo kiểu "thêm/xoá 1 item qua HTTP route" — khác hẳn `pluginConfig`, vốn KHÔNG dùng effect/registry gì cả, chỉ đọc/ghi Postgres trực tiếp mỗi lần).

→ Quyết định thiết kế: **thêm 2 method mới, KHÔNG effect-scoped**, vào `SkillRegistryService`/`SkillRegistry` — `upsert()`/`remove()` — dùng riêng cho entry có `ownerId` (vòng đời do Postgres CRUD quản lý tường minh, không phải do plugin mount/unmount). `register()` giữ nguyên 100% cho skill build-time hiện có.

## 2. Bug tiềm ẩn phải xử lý trước: Map key trùng tên giữa 2 user

`SkillRegistry` hiện lưu `Map<string, Entry>` khoá bằng `def.name` — namespace DUY NHẤT toàn hệ thống. Nếu 2 user khác nhau đặt tên skill riêng trùng nhau (vd. cả hai đặt "research"), `upsert()` thứ hai sẽ **ghi đè âm thầm** entry của người đầu (last-write-wins) — vỡ cách ly dữ liệu giữa 2 user, không phải edge case hiếm (tên skill thông dụng rất dễ trùng).

Fix: đổi khoá lưu trữ nội bộ thành **composite** `ownerId ? `user:${ownerId}:${name}` : `global:${name}`` — biến `def.name` (hiển thị) tách khỏi khoá Map. Toàn bộ method (`register`, `upsert`, `get`, `has`, `remove`) tính lại khoá composite từ `(name, ownerId)` truyền vào. `list()`/`match()` không đổi cách duyệt (vẫn `[...map.values()]`), chỉ thêm filter theo `visibleTo` (mục 3).

## 3. Seam changes — `seams/skill.ts`

```ts
export interface SkillDefinition {
  name: string
  description: string
  instructions: string
  triggers: string[]
  userInvocable?: boolean
  resources?: SkillResource[]
  /** undefined = skill global (built-in). Set = skill riêng của 1 user, chỉ họ (và admin) thấy được. */
  ownerId?: string
}

export interface SkillListOptions {
  userInvocableOnly?: boolean
  topLevelOnly?: boolean
  /** userId của caller. Khi set: ẩn mọi skill có ownerId khác giá trị này (skill global luôn hiện). Không set = chỉ thấy skill global (dùng cho path không có identity, vd. benchmark). */
  visibleTo?: string
}

export abstract class SkillRegistryService extends Service {
  abstract register(def: SkillDefinition, readResource?: SkillResourceReader): void  // KHÔNG đổi — build-time, effect-scoped
  abstract upsert(def: SkillDefinition): void        // MỚI — không effect-scoped, dùng cho def.ownerId có giá trị
  abstract remove(name: string, ownerId: string): boolean  // MỚI — true nếu đã xoá
  abstract get(name: string, visibleTo?: string): SkillDefinition | undefined  // + tham số visibleTo
  abstract has(name: string, ownerId?: string): boolean
  abstract list(options?: SkillListOptions): SkillDefinition[]  // filter theo visibleTo
  abstract match(userMessage: string, visibleTo?: string): SkillDefinition[]  // + tham số visibleTo
  abstract readResource(skillName: string, resourcePath: string, visibleTo?: string): Promise<SkillResourceContent>
}
```

`get()`/`match()`/`readResource()` khi `skill.ownerId` tồn tại và khác `visibleTo` → coi như không tìm thấy (không rò rỉ nội dung skill riêng của người khác qua đoán tên).

## 4. Seam mới — `seams/custom-skills.ts` + provider `bundles/providers/custom-skill-store-postgres`

Theo đúng tinh thần seam-first (coding rule A6, xem comment trong `seams/plugin-config.ts`): `ctx.skills` chỉ là catalog/runtime thuần, KHÔNG nên tự biết về "user sở hữu skill này, CRUD ra sao, validate gì". Tách riêng seam sở hữu nghiệp vụ đó, seam này gọi `ctx.skills.upsert/remove` để đồng bộ runtime.

```ts
// seams/custom-skills.ts
export interface CustomSkillInput {
  name: string          // slug, ví dụ /^[a-z0-9][a-z0-9-]{1,63}$/
  description: string   // <= 280 ký tự
  instructions: string  // nội dung file .md, <= 64 KiB
  triggers: string[]    // <= 20 từ khoá, mỗi từ <= 64 ký tự
}

export interface CustomSkillRecord extends CustomSkillInput {
  ownerId: string
  createdAt: string
  updatedAt: string
}

export abstract class CustomSkillStoreService extends Service {
  abstract create(ownerId: string, input: CustomSkillInput): Promise<CustomSkillRecord>
  abstract update(ownerId: string, name: string, input: CustomSkillInput): Promise<CustomSkillRecord>
  abstract delete(ownerId: string, name: string): Promise<void>
  abstract listByOwner(ownerId: string): Promise<CustomSkillRecord[]>
  /** Admin-only moderation — trả toàn bộ, mọi owner. */
  abstract listAll(): Promise<CustomSkillRecord[]>
}
```

Provider (`bundles/providers/custom-skill-store-postgres/index.ts`) — copy nguyên pattern `plugin-config-postgres` (pool riêng, cùng `DATABASE_URL` đã bắt buộc — KHÔNG thêm biến môi trường mới, retry-with-backoff giống hệt):

```sql
CREATE TABLE IF NOT EXISTS custom_skills (
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  triggers TEXT NOT NULL,       -- JSON array, đơn giản hơn bảng phụ vì <=20 item
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, name)
)
```

Không FK sang `users` (đúng triết lý "pool riêng, vòng đời độc lập" đã ghi trong comment `plugin-config-postgres`/`memory-core` — không có FK cross-service nào khác trong repo).

`[Service.init]`: sau khi `CREATE TABLE`, `SELECT * FROM custom_skills` → gọi `ctx.skills.upsert()` cho từng row — warm lại in-memory registry lúc **boot/redeploy** (đây là lý do custom skill vẫn sống sót qua `docker compose up -d --force-recreate`, không chỉ CRUD runtime). `create/update/delete` mỗi call: ghi Postgres trước, rồi gọi `ctx.skills.upsert()`/`remove()` NGAY để có hiệu lực tức thì — không cần restart, giống đúng lời hứa của `ctx.pluginConfig`.

`inject = ['skills']`.

## 5. Cập nhật các call site đọc `ctx.skills` (thread `visibleTo`)

Đã xác nhận đọc code — đúng 4 chỗ cần sửa:

| File | Dòng | Sửa |
|---|---|---|
| `bundles/loop-drivers/loop-default/index.ts` | 54, 73 | `resolveActiveSkills(runCtx.skills, userMessage, input.selectedSkill, session.ownerId)`; `runCtx.skills.list({ topLevelOnly: true, visibleTo: session.ownerId })` |
| `bundles/loop-drivers/loop-rlm/index.ts` | 177-178 | tương tự, `session.ownerId` (session đã có sẵn trong `runTurn`) |
| `src/skill-runtime.ts` (`resolveActiveSkills`) | toàn hàm | thêm tham số `visibleTo?: string`, truyền xuống `registry.get(selectedSkill, visibleTo)` và `registry.match(message, visibleTo)` |
| `bundles/tools/tool-skill/index.ts` | 32, 34 | `invocation.sessionId` có sẵn nhưng KHÔNG có ownerId trực tiếp (`ToolInvocationContext` chỉ có `sessionId/source/principal/...`, `principal` hiện không được set = ownerId ở đâu cả). Thêm `'sessions'` vào `inject` hiện tại (`['tools', 'skills', 'storage']`), resolve `ctx.sessions.get(invocation.sessionId)?.ownerId` rồi truyền vào `get()`/`list()`. |
| `bundles/adapters/api-rest/index.ts` | 605-610 (`GET /skills`) | route này đã có `identity` bắt buộc (không nằm trong `PUBLIC_PATHS`) — thêm `visibleTo: identity!.userId` vào `.list()` |

Không đổi `bundles/providers/sandbox-ipython`, `sandbox-docker`, `agent-runner`, `loop-planner-critic`, `bundles/skills/skill-support-tone` — grep trước đó cho thấy các file này chỉ import type hoặc không gọi `list/match/get` trực tiếp (double-check lại lúc code, không giả định).

## 6. REST API mới — `bundles/adapters/api-rest/index.ts`

Copy đúng pattern khối `/plugin-settings` (dòng 572-592) — auth check qua `identity` (đã resolve, không public path), không cần route admin-only riêng cho CRUD-own vì đây là "sở hữu chính mình", giống hệt `/sessions`/`/projects` (check `ownerId === identity.userId`), KHÔNG dùng `ctx.permission` (RBAC action) cho phần này.

```
GET    /custom-skills              → ctx.customSkills.listByOwner(identity.userId)
POST   /custom-skills               body { name, description, instructions, triggers } → create(...)
PUT    /custom-skills/:name         body giống trên → update(...)
DELETE /custom-skills/:name         → delete(identity.userId, name)
```

`POST`/`PUT`: validate ở tầng route trước khi gọi service (400 rõ ràng, giống khối `/plugin-settings` validate `body.value` phải là string không rỗng) — `name` khớp regex slug, `instructions` không rỗng và `<= 64 * 1024` byte (dùng `Buffer.byteLength`), `triggers` là mảng string. `readJsonBody` đã có giới hạn `DEFAULT_MAX_BODY_BYTES = 1 MiB` — đủ cho 1 file `.md` đơn (không có resource/attachment kèm theo, ngoài phạm vi tính năng này).

Ownership: mọi route trên chỉ thao tác trên `(identity.userId, name)` — không cần "admin override" vì đây là dữ liệu CỦA CHÍNH caller. Route admin-moderation riêng:

```
GET /admin/custom-skills   → action 'admin:skills:manage' (permission mới, cùng pattern admin:plugins:configure) → ctx.customSkills.listAll()
DELETE /admin/custom-skills/:ownerId/:name  → cùng action, admin xoá skill của bất kỳ user nào (kiểm duyệt nội dung vi phạm)
```

Client upload: đọc file `.md` bằng `FileReader.readAsText()` ngay trên UI rồi gửi JSON bình thường (`instructions` là string) — **không cần multipart parser mới** trên server (server hiện chỉ có `readJsonBody`, không có parser multipart nào; endpoint `/sessions/:id/files` dùng cơ chế khác cho dataset nhị phân, không tái dùng ở đây vì không cần).

## 7. UI — package mới `packages/ui-skill-manager` + wiring

Copy cấu trúc `packages/ui-plugin-settings` (đã đọc `PluginSettingsPanel.tsx` + `pluginSettingsApi.ts` làm mẫu):

```
packages/ui-skill-manager/
├── package.json
├── src/
│   ├── index.ts
│   ├── customSkillApi.ts       # fetch wrapper GET/POST/PUT/DELETE /custom-skills
│   ├── SkillManagerPanel.tsx   # Modal — list + form thêm/sửa + input file .md
│   └── SkillManagerPanel.module.css
└── tests/
    └── SkillManagerPanel.test.tsx
```

`SkillManagerPanel.tsx` (dùng `Modal`, `Button`, `TextField` từ `ui-primitives`; **cần thêm 1 primitive mới `Textarea`** vào `ui-primitives` — chưa tồn tại, chỉ có `TextField` 1 dòng — dùng cho ô nội dung `.md` khi user paste tay thay vì upload file):

- List skill của chính user (tên, mô tả, số trigger) — click mở rộng như `PluginSettingsPanel` (`expandedKey` pattern).
- Form thêm: `TextField` tên, `TextField` mô tả, `TextField` triggers (comma-separated, khớp `metadata.triggers` format của `skill-filesystem`), `<input type="file" accept=".md">` (theo đúng pattern `handleFileChange` của `WorkspaceHeaderPanel.tsx`) ĐỌC bằng `FileReader.readAsText()` rồi đổ vào state → hiển thị lại trong `Textarea` để user xem/sửa trước khi Lưu (không phải black-box upload).
- Nút Sửa (PUT), Xoá (DELETE) trên mỗi row.
- Preview: hiện instructions dạng monospace/read-only trước khi lưu (tránh submit nhầm).

Wiring vào `apps/web/src/App.tsx` (copy đúng chỗ `PluginSettingsPanel` đang wire, dòng 48-49, 257, 1332, 1483-1485):

```tsx
import { SkillManagerPanel } from '@agent-core/ui-skill-manager'
const [skillManagerOpen, setSkillManagerOpen] = useState(false)
// truyền onOpenSkillManager={() => setSkillManagerOpen(true)} xuống Sidebar
<SkillManagerPanel open={skillManagerOpen} onClose={() => setSkillManagerOpen(false)} restUrl={...} token={...} />
```

`packages/ui-sidebar/src/Sidebar.tsx`: thêm nút "Kỹ năng" theo đúng mẫu nút "Cấu hình" (dòng 265-278: `Tooltip` + icon button khi sidebar thu gọn, `settingsTrigger` label khi mở rộng) — **khác biệt quan trọng**: nút "Cấu hình" hiện chỉ có 1 điểm vào chung; nút "Kỹ năng" hiển thị cho **mọi user** (không ẩn theo role — khác `admin:plugins:configure`), vì đây là tính năng cá nhân, không phải admin-only. Cần thêm prop `onOpenSkillManager: () => void` vào `SidebarProps`.

## 8. Bảo mật / giới hạn

- Nội dung skill chèn thẳng vào system prompt của CHÍNH session người tạo — không tăng bề mặt tấn công so với hiện trạng (user vốn gõ được bất kỳ instruction nào vào tin nhắn/systemPrompt lúc tạo session).
- Giới hạn cứng: `instructions <= 64 KiB`, `triggers.length <= 20`, `description <= 280`, `name` slug regex — chặn abuse (skill khổng lồ tốn context, tên trùng ký tự lạ phá route `/custom-skills/:name`).
- Không hỗ trợ `resources` (asset/script/template con) cho custom skill — chỉ 1 file `.md` phẳng, đúng đúng scope "user tự add file md" user yêu cầu; nếu sau này cần, mở rộng riêng (ngoài phạm vi plan này).
- Rate-limit số skill/user (đề xuất: cap cứng 50 skill/user ở tầng `create()` — trả 409 khi vượt) — tránh 1 user tạo hàng loạt làm phình bảng/registry.
- `GET /custom-skills` (own) không cần permission action riêng; `GET/DELETE /admin/custom-skills/*` bắt buộc `admin:skills:manage` (thêm rule vào cấu hình `permission-rbac`, chỗ nào đang khai `admin:plugins:configure`/`admin:users:manage` cho role admin).

## 9. Test plan

- `tests/skill-registry.test.ts` (đã có, 6 case Phase 15) — thêm case: 2 skill khác `ownerId` cùng `name` không đè nhau (mục 2); `list({visibleTo})`/`match(msg, visibleTo)`/`get(name, visibleTo)` ẩn đúng skill riêng của người khác; skill global (`ownerId` undefined) luôn thấy bất kể `visibleTo`.
- Test mới `tests/custom-skill-store.test.ts` — CRUD Postgres (dùng test container/`agent-core-test-pg` đã thấy chạy sẵn trong `docker ps`), warm-on-boot đọc đúng row có sẵn.
- Test REST — case ownership: user A không `GET/PUT/DELETE` được skill của user B qua `/custom-skills/:name` (404, không phải 403 — tránh leak tồn tại tên đó, cùng tinh thần "không rò rỉ" của mục 3).
- `SkillManagerPanel.test.tsx` — theo mẫu `PluginSettingsPanel.test.tsx`: render list, submit form gọi đúng API, xoá gọi đúng API.
- E2E thủ công: tạo skill custom qua UI → gửi tin nhắn chứa trigger trong 1 session mới → xác nhận `skill_loaded` event xuất hiện (giống cách `docs/agent-core-skill-business-case-builder-plan.md` mục Follow-up đã verify E2E thật, không chỉ đọc code).

## 10. Rollout theo phase

1. **Phase A** — seam `skill.ts` (composite key + `visibleTo`) + cập nhật `SkillRegistry` + 5 call site mục 5. Chạy lại toàn bộ test skill hiện có, không được regress skill global.
2. **Phase B** — seam `custom-skills.ts` + provider `custom-skill-store-postgres` + REST `/custom-skills` (own) + `/admin/custom-skills` (moderation) + permission rule.
3. **Phase C** — `packages/ui-skill-manager` + primitive `Textarea` mới trong `ui-primitives` + wiring `Sidebar`/`App.tsx`.
4. **Phase D** — test E2E thật qua Docker (dùng chính flow "redeploy" vừa làm ở phiên trước: `docker compose build agent-core && docker compose up -d agent-core`), verify skill sống sót qua restart (mục 4, warm-on-boot).

Mỗi phase build xong nên cập nhật doc này (đổi tiêu đề mục sang "ĐÃ BUILD" giống style các plan khác trong `docs/`) thay vì tạo file mới.

## 11. Đã build + verify thật (2026-08-27)

Cả 4 phase đã implement, KHÔNG cắt giảm so với plan gốc (composite key, ownership filter ở cả 5 call site, admin moderation route, UI đầy đủ). Verify thật qua Docker (không chỉ đọc code):

- `npx tsc --noEmit` xanh toàn repo; `vitest run` xanh **348/348** test (thêm 3 test ownership mới trong `tests/skill-registry.test.ts`, 2 test `Textarea` mới, 6 test `SkillManagerPanel` mới, 1 test `Sidebar` mới).
- **Regression thật đã bắt và sửa lúc build**: thêm `'sessions'` vào `inject` cứng của `tool-skill` làm rỗng TOÀN BỘ tool catalog ở `tests/skill-semantic-discovery.test.ts` (fixture không mount session-registry) — sửa bằng soft-read `ctx.get('sessions')` thay vì inject cứng, cùng pattern `ctx.get('memory')` đã có ở loop-default. Thêm `'customSkills'` vào `inject` của `api-rest` cũng làm treo PENDING toàn bộ fiber ở 2 fixture của `tests/api-rest.test.ts` (21 test) vì thiếu mount `custom-skill-store-postgres` — đã thêm mount vào cả 2 fixture.
- `docker compose build agent-core && docker compose up -d --force-recreate agent-core` — build sạch, container `healthy`, log `[custom-skill-store-postgres] connected (Postgres)`.
- E2E thật qua REST (curl, không phải giả định): signup 2 user riêng biệt → user A tạo skill `meeting-notes` (trigger `meeting`/`họp`) → `GET /skills` của A thấy đúng skill → gửi tin nhắn thật chứa "meeting" trong session mới → `GET /sessions/:id/events` xác nhận `{"type":"skill_loaded","source":"default-loop","activation":"trigger","skill":"meeting-notes"}` — đúng cơ chế trigger, không phải suy đoán từ giọng văn model.
- **Cách ly owner xác nhận thật**: user B (`GET /skills`) KHÔNG thấy `meeting-notes`; `GET /custom-skills` của B rỗng; `PUT /custom-skills/meeting-notes` bằng token B → 404 (không phải 403 — không lộ tồn tại tên đó cho người không sở hữu).
- **Sống sót qua redeploy xác nhận thật**: `docker compose up -d --force-recreate` lần 2 → log `warmed 1 custom skill(s) into ctx.skills` → `GET /custom-skills`/`GET /skills` của user A vẫn thấy đúng skill sau khi container bị recreate hoàn toàn.
- Dọn dữ liệu smoke test: đã `DELETE /custom-skills/meeting-notes` (user A) sau khi verify xong.

**Lưu ý cho user**: lúc smoke test đã lỡ tạo 2 tài khoản phụ trên chính Postgres local của bạn — `skilltestuser` và `otheruser_smoketest` (password test, vô hại) — và một tài khoản thật tên **"tyler"** (do biến shell `$USERNAME` trong script test bị trùng tên với biến môi trường hệ thống, không phải chủ đích). Cả 3 đều là user thường (role `user`), không phải admin, không đụng được gì ngoài custom skill của chính họ. Muốn dọn thì cần đăng nhập bằng tài khoản admin gốc và gọi `DELETE /users/:id` (hoặc qua UI "Quản lý người dùng") — mình không có quyền admin nên không tự xoá được.
