# Rate-limiting (plan) + Security audit (thật, đã chạy) — authn/authz toàn bộ plugin

User: "Lên plan update rate limit cho API và kiểm tra security cho authen
author của các plugin". Doc này có 2 phần tách biệt:

- **Phần A** — audit THẬT, đã đọc từng file, không đoán: đi qua toàn bộ
  `bundles/{providers,tools,subagents,skills,loop-drivers,adapters}` kiểm
  tra authn (ai đang gọi) / authz (họ được phép làm gì) / timing-attack /
  rò rỉ thông tin lỗi / phạm vi `PUBLIC_PATHS` / cô lập `memory-tencentdb` /
  permission-gating của tool-registry. Mỗi finding có file:line + kịch bản
  khai thác cụ thể + mức độ + fix đề xuất.
- **Phần B** — PLAN (chưa implement) cho rate-limiting, seam mới + provider
  mới theo đúng kiến trúc seam-first của cả repo, số cụ thể, không chung
  chung.

Không có gì trong Phần A bị sửa trong lúc viết doc này — đây thuần là audit
+ plan, KHÔNG phải implementation (đúng scope user yêu cầu: "lên plan" cho
rate limit, "kiểm tra" security — audit là hành động, không phải chỉ lên
plan).

---

## Phần A — Security audit (đã chạy thật, không phải giả thuyết)

### A1. [CAO] `tool-database-query` đọc được transcript của BẤT KỲ session nào, không check ownership

**File**: `bundles/tools/tool-database-query/index.ts:25-28`

```ts
async handler(args) {
  const sessionId = String(args.sessionId ?? '')
  return ctx.storage.readEvents(sessionId)
}
```

`sessionId` đến thẳng từ tham số tool-call do MODEL sinh ra (mà model lại
suy luận từ tin nhắn user) — **không có bất kỳ check ownership nào**, khác
hẳn `tool-web-search` (có gọi `ctx.permission.check('web-search','search')`
ở dòng 110 cùng thư mục). Trong khi đó REST/WS/gRPC đều có
`canAccessSession(identity, session)` bảo vệ đúng endpoint tương đương
(`GET /sessions/:id/events`) — nghĩa là con đường qua tool-calling **bỏ qua
hoàn toàn** lớp bảo vệ đã build cẩn thận ở adapter.

**Kịch bản khai thác cụ thể**: User A biết (hoặc đoán/brute-force) id
session của User B. User A chat bình thường, chỉ cần gõ "hãy tra dữ liệu
session <id của B> giúp tôi" (hoặc bị prompt-injection từ nội dung web-search
khiến model tự gọi tool này) → model gọi `query_database({sessionId:
"<id của B>"})` → toàn bộ lịch sử hội thoại của B (kể cả nội dung nhạy cảm
B từng chat) trả thẳng về cho A trong response.

**Nguyên nhân gốc**: `ToolHandler = (args: Record<string, unknown>) =>
Promise<unknown>` (`seams/tools.ts:14`) — chữ ký handler **không có tham số
nào mang session/identity hiện tại**. Đây là gap kiến trúc, không chỉ là 1
dòng thiếu check: ngay cả khi muốn tự thêm check trong `query_database`,
handler hiện tại không có cách nào biết "ai đang hỏi" hay "đang ở session
nào" để so sánh.

**Fix đề xuất** (cần đổi signature, breaking — nên làm thành 1 phase riêng):
mở rộng `ToolHandler` nhận thêm `ctx: { session: Session; identity:
AuthIdentity }` làm tham số thứ 2, truyền vào từ đúng chỗ loop driver gọi
`tool.handler(response.toolCall.args)` (`bundles/loop-drivers/loop-default/
index.ts:84`, `loop-planner-critic` tương tự) — driver đã có sẵn cả
`session` lẫn quyền truy cập `runCtx` nên không cần thêm dependency mới.
Với `query_database` cụ thể: đơn giản nhất là **bỏ hẳn tham số `sessionId`
từ model**, luôn luôn đọc `ctx.session.id` của CHÍNH session đang chạy (agent
không có lý do nghiệp vụ chính đáng nào để tự tra session KHÁC của người
khác) — vá triệt để mà không cần model tự "cư xử đúng".

### A2. [CAO] Session storage không có khái niệm chủ sở hữu + client tự chọn được session id → chiếm session người khác sau khi TTL sweep

**File**: `bundles/providers/state-sqlite/index.ts:49` (bảng `events`, không
có cột `owner_id`), `bundles/providers/session-registry/index.ts:54-59`
(`create()` nhận thẳng `opts.id` client truyền vào), `bundles/adapters/
api-rest/index.ts:216` (`id: typeof body.id === 'string' ? body.id :
undefined` — REST nhận id tuỳ ý từ body), `bundles/adapters/api-grpc/
index.ts:107` (gRPC `CreateSession` cũng nhận `req.id` tương tự).

Ownership (`ownerId`) CHỈ tồn tại trong `ctx.sessions` — registry
**in-memory, bị sweep theo TTL trượt** (mặc định 30 phút không hoạt động,
`bundles/providers/session-registry/index.ts:18`). Transcript thật nằm ở
`ctx.storage` (SQLite) — bảng `events` chỉ khoá theo `sessionId` (chuỗi),
**hoàn toàn không biết ai là chủ** của log đó.

**Kịch bản khai thác cụ thể**: User B tạo session id `"demo-1"` (hoặc bất kỳ
id nào — REST/gRPC cho phép tự đặt id), chat vài lượt (events ghi thật vào
SQLite dưới key `"demo-1"`), rồi rời đi >30 phút → entry `"demo-1"` bị sweep
khỏi `ctx.sessions` (nhưng events vẫn còn nguyên trong SQLite, không ai xoá).
User A (biết hoặc đoán đúng id `"demo-1"`, dễ nếu id ngắn/dễ đoán/dùng chung
convention đặt tên giữa nhiều integration) gọi `POST /sessions` với
`{"id":"demo-1"}` → `session-registry.create()` thấy `"demo-1"` KHÔNG còn
trong Map (đã bị sweep) nên tạo mới thành công, gán `ownerId = A`. A gọi
tiếp `GET /sessions/demo-1/events` → `canAccessSession()` pass (A giờ là
chủ session "demo-1" theo registry) → `ctx.storage.readEvents("demo-1")`
trả về **toàn bộ lịch sử cũ của B**, vì storage chưa từng biết "demo-1" đổi
chủ.

Với id sinh tự động (`randomUUID()`, 122 bit entropy) rủi ro đoán trúng gần
như bằng 0 — nhưng bug nằm ở chỗ **cơ chế kiểm tra sở hữu hoàn toàn dựa vào
trạng thái ephemeral (registry), trong khi dữ liệu thật là durable
(SQLite)** — 2 tầng lệch nhau là gốc rễ, id ngắn/tự chọn chỉ là 1 cách khai
thác cụ thể, không phải nguyên nhân duy nhất (restart process cũng xoá sạch
registry mà không đụng SQLite, cùng hệ quả).

**Fix đề xuất** (2 lựa chọn, không loại trừ nhau):
1. **Ngắn hạn, rẻ**: `POST /sessions` (REST) và `CreateSession` (gRPC) BỎ
   HẲN khả năng client tự chọn `id` — luôn `randomUUID()` server-side. Xoá
   vector "đoán/chọn trùng id" hoàn toàn, không cần đổi schema.
2. **Đúng gốc, tốn hơn**: thêm cột `owner_id` vào bảng `events`
   (`state-sqlite`), `appendEvent`/`readEvents` nhận thêm `ownerId`, và
   `readEvents` tự chặn nếu `ownerId` đã ghi trước đó khác với người đang
   đọc (kể cả sau khi registry bị sweep/restart) — biến "ai được đọc log
   này" thành sự thật do CHÍNH storage layer giữ, không phụ thuộc vào
   registry ephemeral còn sống hay không.

### A3. [CAO] Timing side-channel ở `login()` để lộ username có tồn tại hay không

**File**: `bundles/providers/auth-users/index.ts:145-155`

```ts
async login(username: string, password: string): Promise<AuthResult> {
  const { rows } = await this.pool.query('SELECT * FROM users WHERE username = $1', [username.trim()])
  const row = rows[0]
  if (!row || !row.active) throw httpError('sai tên đăng nhập hoặc mật khẩu', 401)   // <- trả NGAY, không chạy scrypt
  const candidate = scryptSync(password, row.password_salt, SCRYPT_KEY_LENGTH)        // <- chỉ chạy khi username CÓ tồn tại
  ...
}
```

Thông điệp lỗi cố tình chung chung ("sai tên đăng nhập hoặc mật khẩu") để
KHÔNG lộ username có tồn tại hay không — nhưng thời gian phản hồi lại lộ
chính xác điều đó: username không tồn tại trả lỗi gần như tức thì (chỉ 1
query SELECT), còn username tồn tại nhưng sai password phải chạy
`scryptSync` xong (`scrypt` cố tình chậm, tốn CPU — đúng mục đích chống
brute-force offline, nhưng ở đây lại tạo ra 1 kênh timing rất rõ ràng, dễ đo
qua network kể cả có jitter). Kẻ tấn công đo latency là liệt kê được danh
sách username hợp lệ, dù response body giống hệt nhau.

**Fix đề xuất**: LUÔN chạy 1 lần `scryptSync` (dummy, với salt cố định hoặc
salt ngẫu nhiên bất kỳ) ngay cả khi `!row`, trước khi throw lỗi — đảm bảo
thời gian xử lý gần như hằng định bất kể username có tồn tại hay không.

### A4. [CAO] Không có rate-limiting ở BẤT KỲ đâu — brute-force + DoS qua chính cơ chế bảo mật (scrypt)

Xác nhận bằng cách đọc toàn bộ 3 adapter (`api-rest`, `api-ws`, `api-grpc`)
— không có middleware/counter/throttle nào. `PUBLIC_PATHS`
(`api-rest/index.ts:94`) gồm đúng `/health`, `/ready`, `/auth/signup`,
`/auth/login` — 2 endpoint sau là **ghi dữ liệu thật, không cần token
trước**, và không giới hạn tần suất:

- **Credential stuffing / brute-force `/auth/login`**: không giới hạn số
  lần thử — kết hợp với A3, kẻ tấn công vừa liệt kê được username hợp lệ,
  vừa thử password không giới hạn.
- **Spam account qua `/auth/signup`**: không giới hạn, có thể tạo hàng loạt
  user rác (bảng `users` phình vô hạn — không có kiểm soát nào khác ngoài
  `password.length < 8`).
- **DoS tự gây ra bởi chính `scrypt`**: `scryptSync` cố tình tốn CPU/RAM
  (đó là lý do nó chống brute-force offline tốt) — nhưng đúng vì vậy, gửi
  nhiều request `/auth/login` hoặc `/auth/signup` đồng thời là cách RẺ để
  1 client độc hại làm CPU server bão hoà, ảnh hưởng tới mọi user khác đang
  dùng service (kể cả các turn LLM đang chạy dở, vì Node đơn luồng cho CPU-
  bound work).
- Ngoài 2 endpoint public, các endpoint ĐÃ auth (đặc biệt
  `POST /sessions/:id/messages`, mỗi lần gọi tốn 1 lượt LLM thật — chi phí
  cao nhất trong toàn hệ thống) cũng không có giới hạn tần suất theo user.

Xem Phần B cho thiết kế cụ thể.

### A5. [TRUNG BÌNH] Handler lỗi chung trả thẳng `err.message` cho MỌI lỗi 500 chưa lường trước

**File**: `bundles/adapters/api-rest/index.ts:116-119`

```ts
handle(ctx, req, res, maxBodyBytes).catch((err: any) => {
  ctx.logger('api-rest').error(err)
  if (!res.headersSent) sendJson(res, err?.status ?? 500, { error: err?.message ?? 'internal error' })
})
```

Lỗi được ném có chủ đích qua `httpError()` (auth-users, v.v.) có message
đã "curated", an toàn để trả cho client. Nhưng bất kỳ lỗi KHÔNG lường
trước nào khác (driver Postgres báo lỗi constraint/connection, lỗi
TypeScript runtime, v.v.) cũng đi qua đúng nhánh này và message của nó bị
echo thẳng ra ngoài — có thể lộ chi tiết nội bộ (tên bảng, đường dẫn file,
cấu trúc query) cho bất kỳ ai gọi API.

**Fix đề xuất**: chỉ echo `err.message` khi `err.status` được set tường
minh (dấu hiệu đây là lỗi "curated" ném có chủ đích qua `httpError()`);
mặc định (không có `.status`) → trả message chung ("internal error"), chi
tiết thật chỉ nằm trong log server (`ctx.logger(...).error(err)` đã có
sẵn, đủ cho debug).

### A6. [TRUNG BÌNH] gRPC không có transport encryption — token đi plaintext

**File**: `bundles/adapters/api-grpc/index.ts:176`
(`grpc.ServerCredentials.createInsecure()`)

Đã được nêu chung ở mục "Rủi ro cần theo dõi" cuối
`docs/agent-core-cordis-build-plan.md` cho cả REST/WS/gRPC — nhắc lại ở đây
vì gRPC là adapter DUY NHẤT trong 3 cái mang token qua metadata mà không có
đường tắt "đặt sau reverse-proxy TLS-terminating" dễ như REST/WS (gRPC cần
cấu hình TLS credentials tường minh trong chính code, không chỉ proxy ở
tầng network). Chưa cần fix ngay nếu gRPC chỉ chạy trong mạng nội bộ tin
cậy (đúng mô hình triển khai hiện tại) — nhưng PHẢI làm trước khi expose
gRPC ra ngoài mạng không tin cậy.

### A7. [THẤP] `memory-tencentdb` fallback `userId: 'anonymous'` là dead code hiện tại, nhưng là bẫy tiềm ẩn

**File**: `bundles/providers/memory-tencentdb/index.ts:96`
(`context?.userId ?? 'anonymous'`)

Hiện tại KHÔNG khai thác được — mọi session hợp lệ đều có `ownerId` thật từ
identity đã verify (REST/WS/gRPC đều gán đúng). Nhưng nếu tương lai có 1
đường tạo Session nào bỏ sót `ownerId` (bug, hoặc 1 adapter mới quên gán),
mọi request "vô danh" đó sẽ CHIA SẺ CHUNG 1 bucket memory `'anonymous'` —
người dùng ẩn danh (giả định) A có thể `recall()` ra note của B nếu cả 2 vô
tình rơi vào cùng nhánh thiếu ownerId. Khuyến nghị: bỏ fallback, throw rõ
ràng nếu `context?.userId` thiếu — biến bug "quên gán ownerId" thành lỗi ồn
ào ngay lúc build/test thay vì rò rỉ âm thầm lúc chạy thật.

### A8. [THẤP, chỉ ghi nhận] Chính sách mật khẩu tối giản

**File**: `bundles/providers/auth-users/index.ts:125`
(`password.length < 8`) — chỉ kiểm tra độ dài tối thiểu, không kiểm tra độ
phức tạp/danh sách mật khẩu rò rỉ. Theo hướng dẫn NIST hiện hành, độ dài
quan trọng hơn độ phức tạp, và rate-limiting (A4) là lớp phòng thủ chính
chống đoán mật khẩu trực tuyến — coi đây là baseline chấp nhận được, không
phải lỗi, miễn A4 được xử lý.

### Đã kiểm tra, KHÔNG có finding

- `permission-rbac` (`bundles/providers/permission-rbac`): deny-by-default
  đúng nghĩa (`this.rules[actor] ?? []`, không có rule tường minh = từ
  chối) — không có gap.
- `tool-web-search`: có gọi `ctx.permission.check` đúng chỗ trước khi chạm
  network ngoài, có timeout (Phase 11), không lộ thông tin nhạy cảm.
- `web-ui` adapter: chỉ serve static file, có containment-check chống path
  traversal (đã verify thực nghiệm, xem comment trong chính file), không
  chạm dữ liệu người dùng.
- `subagent-manager`, `skill-registry`/`skill-support-tone`,
  `loop-registry`: không chạm tài nguyên nhạy cảm/network/dữ liệu người
  dùng trực tiếp — không có bề mặt authz cần kiểm tra ở tầng này.
- `.dockerignore` loại trừ đúng `.env`/`.env.*` (giữ `.env.example`) —
  không rò rỉ secret vào image build context.
- Token/password: không lưu token thô (chỉ lưu sha256 hash), password hash
  bằng scrypt + salt riêng từng user + so khớp `timingSafeEqual` — đúng
  thực hành chuẩn, không có finding (ngoại trừ A3 ở tầng flow, không phải
  tầng thuật toán hash).

---

## Phần B — Plan rate-limiting (CHƯA implement)

### Thiết kế: seam mới `ctx.ratelimit`, theo đúng seam-first như mọi capability khác trong repo

`seams/ratelimit.ts` (MỚI):

```ts
export interface RateLimitDecision {
  allowed: boolean
  /** ms tới khi window hiện tại reset — dùng cho header Retry-After / thông báo client. */
  retryAfterMs: number
}

export abstract class RateLimitService extends Service {
  constructor(ctx: Context) { super(ctx, 'ratelimit') }
  /**
   * Fixed-window counter theo `key` (caller tự chọn: theo IP, theo userId,
   * theo "IP+route", ...). `limit`/`windowMs` truyền per-call — cho phép
   * áp nhiều policy khác nhau (vd. login: 5/60s theo IP VÀ 10/900s theo
   * username) qua CÙNG 1 service, không cần nhiều seam.
   */
  abstract consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>
}
```

`bundles/providers/ratelimit-memory` (MỚI) — in-memory `Map<key,
{count, windowStartedAt}>`, cùng tinh thần với `session-registry`: đủ cho
1 process, seam đã tách sẵn nên multi-instance sau này chỉ cần đổi
provider (Redis `INCR`+`EXPIRE`) mà KHÔNG sửa adapter nào. Cần 1 sweep định
kỳ dọn key đã hết hạn từ lâu (tránh Map phình vô hạn — cùng coding rule A14
đã áp dụng cho session-registry).

### Áp dụng cụ thể (số đề xuất, cấu hình qua env như mọi provider khác trong repo)

| Điểm áp | Key | Limit mặc định | Vì sao |
|---|---|---|---|
| `POST /auth/login` | IP (`req.socket.remoteAddress`) | 5 / 60s | Chặn brute-force phân tán chậm theo IP |
| `POST /auth/login` | username đã submit (dù đúng/sai) | 10 / 15 phút | Chặn credential-stuffing dùng nhiều IP nhắm 1 tài khoản cụ thể — bổ sung cho lớp theo IP |
| `POST /auth/signup` | IP | 3 / giờ | Chặn tạo hàng loạt tài khoản rác |
| Mọi endpoint ĐÃ auth (REST) | `identity.userId` | 60 / phút | Trần chung, rẻ để áp dụng đều |
| `POST /sessions/:id/messages` (REST) | `identity.userId` | 20 / phút | Endpoint tốn nhất (1 lượt LLM thật/lần) — trần RIÊNG chặt hơn trần chung |
| WS `send_message` | `identity.userId` | 20 / phút | Cùng lý do — WS không đi qua HTTP nên cần áp thủ công trong `handleMessage()`, dùng CHUNG 1 `ctx.ratelimit.consume()` với REST (cùng key/window, giới hạn thật sự theo user chứ không theo protocol) |
| gRPC `SendMessage`/`StreamTurn` | `identity.userId` | 20 / phút | Cùng bộ đếm dùng chung với REST/WS ở trên (key giống nhau — 1 user không "né" giới hạn bằng cách đổi protocol) |

Con số trên là điểm khởi đầu hợp lý (không phải tuyệt đối) — nên cấu hình
qua env var (`RATE_LIMIT_LOGIN_PER_MIN`, `RATE_LIMIT_MESSAGES_PER_MIN`,
...) theo đúng pattern mọi optional config khác trong `src/serve.ts`
(`optionalNumber(...)`), để chỉnh mà không sửa code.

### Phản hồi khi bị chặn (theo đúng convention từng protocol)

- REST: `429 Too Many Requests` + header `Retry-After: <giây>` + body
  `{"error": "rate limited", "retryAfterMs": ...}`.
- WS: `{ type: 'error', message: 'rate limited', retryAfterMs: ... }` (tái
  dùng type `'error'` đã có, không cần thêm type mới).
- gRPC: `status: RESOURCE_EXHAUSTED` (mã chuẩn gRPC cho đúng tình huống
  này, không phải tự chế mã lỗi riêng).

### Vì sao KHÔNG gộp vào `ctx.permission` (RBAC) có sẵn

`PermissionService.check(actor, action)` trả `boolean` THUẦN, KHÔNG có khái
niệm thời gian/cửa sổ/đếm — ép rate-limit vào đây sẽ phải đổi cả signature
lẫn ngữ nghĩa của permission (từ "được phép hay không" thành "được phép
NGAY BÂY GIỜ hay không, và bao lâu nữa thì được") — 2 khái niệm khác nhau
(authorization vs throttling), tách seam riêng đúng tinh thần seam-first
(1 seam = 1 capability rõ ràng) đã theo xuyên suốt repo.

### Thứ tự build đề xuất (khi được duyệt implement)

1. `seams/ratelimit.ts` + `bundles/providers/ratelimit-memory` + test cô
   lập (fixed-window logic đúng, sweep dọn key hết hạn, không leak timer —
   cùng mức test rigor như `session-registry`).
2. Áp vào `api-rest`: 2 policy cho `/auth/login`, 1 cho `/auth/signup`, 1
   trần chung + 1 trần riêng cho `/sessions/:id/messages`.
3. Áp CÙNG instance `ctx.ratelimit` vào `api-ws`/`api-grpc` cho
   `send_message`/`SendMessage`/`StreamTurn` (key theo `identity.userId`,
   share bộ đếm với REST).
4. `src/serve.ts` mount `ratelimit-memory`, thêm `inject` tương ứng cho cả
   3 adapter, thêm các env var tuỳ chọn.
5. Test end-to-end thật: vượt trần → đúng status code/message từng
   protocol; dưới trần → không ảnh hưởng hành vi hiện tại (regression cho
   toàn bộ 34 test file hiện có phải vẫn xanh).
6. README: thêm dòng "Giới hạn hiện tại" MỚI (an toàn hơn: rate-limit ĐÃ
   có, không còn là gap) + bảng cấu hình env var mới.

Findings A1/A2 (Phần A) nên xử lý **độc lập, không phụ thuộc** vào việc
implement Phần B — rate-limit làm chậm kẻ tấn công, không thay thế được
việc đóng đúng lỗ hổng authz.
