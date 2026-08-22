# Template: wrap 1 LLM model thành plugin `ctx.llm` cho agent-core

> Đưa nguyên file này cho AI (hoặc dev) đang làm ở repo chứa model code. Tài
> liệu này TỰ ĐỦ NGỮ CẢNH — không cần đọc thêm gì khác trong repo
> `agent-core` để hiểu và làm đúng. Sản phẩm giao lại là **1 file duy nhất**:
> `bundles/providers/llm-<ten-model>/index.ts` (đặt `<ten-model>` = tên
> model/repo của bạn, vd. `llm-mymodel`).

---

## 0. Bối cảnh — vì sao có rule kỳ lạ ở dưới, không phải tuỳ tiện

`agent-core` là 1 hệ thống agent build trên **Cordis** (framework
dependency-injection + lifecycle của DeepSeek, KHÔNG phải Express/NestJS).
Cordis có 2 cơ chế lõi:

- **Spatial composability**: 1 plugin khai báo `inject: ['llm']` thì CHỈ
  chạy khi có ai đó cung cấp `ctx.llm` — nếu bạn (provider mới) unmount, mọi
  thứ phụ thuộc `llm` tự "tạm ngưng" (không throw lỗi giữa chừng), tự chạy
  lại khi bạn mount lại. Đây là lý do bạn PHẢI tuân thủ đúng "hợp đồng" ở
  mục 1 — sai hợp đồng thì cơ chế này gãy.
- **Temporal composability**: mọi side-effect (mở connection, load model
  vào RAM, đăng ký gì đó) phải "tự dọn dẹp" đúng thứ tự khi bị gỡ. Cordis tự
  làm việc này CHO BẠN — nhưng chỉ khi bạn viết đúng pattern ở mục 3.

Rule ở mục 2 dưới đây **đều là bug thật đã tìm ra và verify thực nghiệm**
khi build `agent-core` (không phải suy đoán lý thuyết) — bỏ qua 1 trong số
đó sẽ tạo ra lỗi rất khó debug (silent, không throw ngay chỗ sai).

---

## 1. Hợp đồng BẮT BUỘC phải implement

Đây là toàn bộ nội dung `seams/llm.ts` thật trong `agent-core` — copy đúng
y hệt, không sửa:

```typescript
// seams/llm.ts
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmService
  }
}

export interface LlmToolCall {
  name: string
  args: Record<string, unknown>
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface LlmCompletion {
  content: string
  toolCall?: LlmToolCall
}

/** Quảng bá 1 tool cho model — map trực tiếp từ ToolDefinition (seams/tools.ts). */
export interface LlmToolSpec {
  name: string
  description: string
  parameters?: Record<string, unknown>
}

export interface LlmCompleteOptions {
  /** Tool khả dụng cho lượt gọi này. Rỗng/undefined = model không được đề nghị gọi tool. */
  tools?: LlmToolSpec[]
}

export abstract class LlmService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  abstract complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<LlmCompletion>
}
```

Việc của bạn: viết 1 class kế thừa `LlmService`, implement đúng
`complete(messages, options)`:

- **Input** `messages`: lịch sử hội thoại, role `'system' | 'user' | 'assistant' | 'tool'`.
  Role `'tool'` = text mô tả kết quả 1 tool đã chạy (không phải object có
  cấu trúc) — nếu model của bạn cần format khác (vd. cần `tool_call_id`),
  bạn tự chuyển đổi bên trong `complete()`, xem ví dụ ở mục 4.
- **Input** `options.tools`: danh sách tool model được PHÉP đề nghị gọi ở
  lượt này (tên, mô tả, JSON Schema tham số). Nếu model bạn không hỗ trợ
  function-calling, **bỏ qua field này, KHÔNG throw lỗi** — cứ trả lời bình
  thường, không có `toolCall`.
- **Output** `content`: text model trả lời.
- **Output** `toolCall` (optional): CHỈ set nếu model quyết định gọi 1 tool
  trong `options.tools`. Không hỗ trợ tool-calling → luôn để `undefined`,
  đừng "giả vờ" hỗ trợ.

---

## 2. Rule BẮT BUỘC — mỗi rule kèm lý do thật, không phải tuỳ chọn

### Rule 1 — `apply` phải là **arrow function**, KHÔNG được viết `function apply(){}`

```typescript
// SAI — Cordis coi function declaration là constructor (có .prototype), gọi
// bằng `new` — nếu bên trong return 1 disposer, disposer đó BỊ NUỐT MẤT
// trong im lặng, không bao giờ chạy khi gỡ plugin. Đã verify thực nghiệm.
export function apply(ctx, config) { ... }

// ĐÚNG
export const apply = async (ctx, config) => { ... }
```

### Rule 2 — arrow function `apply` phải có **block body `{ }`**, không dùng expression body

```typescript
// SAI — return ngầm về 1 Fiber handle, Cordis hiểu nhầm là Effect cần
// await/collect, throw "Invalid effect", làm sập luôn plugin cha.
export const apply = (ctx, config) => ctx.plugin(MyLlm, config)

// ĐÚNG
export const apply = (ctx, config) => { ctx.plugin(MyLlm, config) }
```

### Rule 3 — nếu `apply` mở resource bất đồng bộ THẬT (network, load model...), PHẢI `async` + `await`/`return` đúng effect

```typescript
// SAI — apply() trả về gần như ngay lập tức, TRƯỚC KHI resource async bên
// trong thật sự sẵn sàng. Ai chờ "plugin đã load xong" sẽ bị race condition
// thật (đã verify thực nghiệm — 1 bug thật đã xảy ra khi build agent-core).
export const apply = (ctx, config) => {
  ctx.plugin(MyLlm, config)   // không await!
}

// ĐÚNG
export const apply = async (ctx, config) => {
  await ctx.plugin(MyLlm, config)
}
```

### Rule 4 — KHÔNG dùng `super(ctx, name, true)` hay bất kỳ tham số thứ 3 nào

`Service` constructor CHỈ nhận `(ctx, name)` — 2 tham số. `LlmService` ở
mục 1 đã tự gọi `super(ctx, 'llm')` đúng rồi — class của bạn kế thừa
`LlmService`, KHÔNG tự viết `super()` nữa trừ khi bạn cần constructor riêng
để nhận `config` (xem template ở mục 4, đúng pattern chuẩn).

### Rule 5 — KHÔNG hard-code API key/endpoint, nhận qua `config` + fallback `process.env`

Xem pattern chuẩn (`LlmDeepseek.Config`) ở mục 4 — namespace `Config` cùng
tên class, optional fields, đọc từ `process.env.<TEN>_API_KEY` nếu
`config.apiKey` không có.

### Rule 6 — không throw exception PHÍA NGOÀI `complete()`/`[Service.init]()`

Mọi lỗi (network fail, model timeout...) throw BÊN TRONG các method này —
Cordis/agent loop tự bắt và xử lý đúng chỗ. Đừng tự `process.exit()` hay
side-effect ngoài luồng.

---

## 3. Model của bạn thuộc loại nào? Chọn 1 trong 2 pattern

### Pattern A — model chạy như 1 API/server độc lập (gọi qua HTTP/gRPC mỗi lần)

Dùng khi: model của bạn đã chạy như 1 service riêng (kể cả local, vd.
`localhost:11434` kiểu Ollama, hay 1 API nội bộ), bạn chỉ cần GỌI vào nó mỗi
lượt `complete()`. **Đây là pattern khuyên dùng nếu không chắc — đơn giản,
không có gì cần dọn dẹp lúc unmount.**

```typescript
// bundles/providers/llm-<ten-model>/index.ts
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../../../seams/llm.ts'

export namespace LlmMyModel {
  export interface Config {
    apiKey?: string
    baseUrl?: string
    model?: string
  }
}

export class LlmMyModel extends LlmService {
  constructor(ctx: Context, public config: LlmMyModel.Config = {}) {
    super(ctx)
  }

  // [Service.init]() CHỈ cần nếu bạn muốn validate config sớm (fail nhanh
  // lúc mount thay vì fail ở lần complete() đầu tiên) — không bắt buộc cho
  // pattern A vì không có resource thật nào cần mở/đóng.
  [Service.init]() {
    const apiKey = this.config.apiKey ?? process.env.MYMODEL_API_KEY
    if (!apiKey) {
      throw new Error('llm-mymodel: missing apiKey (config.apiKey hoặc MYMODEL_API_KEY)')
    }
    this.ctx.logger('llm-mymodel').info('ready (model=%s)', this.config.model ?? 'default')
    // Không return gì cũng được (không có gì cần dọn dẹp) — hoặc return
    // 1 hàm rỗng nếu muốn log lúc detach, tuỳ bạn.
  }

  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    const apiKey = this.config.apiKey ?? process.env.MYMODEL_API_KEY
    const baseUrl = this.config.baseUrl ?? 'http://localhost:PORT_CUA_BAN'

    // TODO: thay bằng cách gọi thật vào model của bạn (fetch/gRPC/SDK riêng).
    // messages đã đúng format seam — map sang format model bạn cần ở đây.
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
      }),
    })
    if (!res.ok) {
      throw new Error(`llm-mymodel: request failed (${res.status} ${res.statusText})`)
    }
    const data = await res.json()

    // TODO: map response thật của model bạn về đúng LlmCompletion.
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      toolCall: undefined, // đổi nếu model bạn hỗ trợ tool-calling — xem mục 5
    }
  }
}

export const apply = async (ctx: Context, config: LlmMyModel.Config = {}) => {
  await ctx.plugin(LlmMyModel, config)
}
```

### Pattern B — model cần LOAD vào RAM / mở connection giữ lâu dài (không gọi HTTP mỗi lần)

Dùng khi: model chạy in-process (vd. binding native, weights load 1 lần rồi
giữ trong RAM), hoặc cần mở 1 connection/session sống lâu (không phải mở-
đóng mỗi request). Khác Pattern A ở chỗ: **PHẢI dùng `[Service.init]()` để
mở lúc mount, return hàm dọn dẹp để đóng lúc unmount** — đây chính là
temporal composability, Cordis tự gọi hàm dọn dẹp đúng lúc, bạn không tự
quản lý.

```typescript
// bundles/providers/llm-<ten-model>/index.ts
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmCompleteOptions, LlmCompletion, LlmMessage, LlmService } from '../../../seams/llm.ts'

export namespace LlmMyModel {
  export interface Config {
    modelPath?: string
    // ... các option load model của bạn
  }
}

export class LlmMyModel extends LlmService {
  private session: any // TODO: thay bằng type thật của session/handle model bạn

  constructor(ctx: Context, public config: LlmMyModel.Config = {}) {
    super(ctx)
  }

  [Service.init]() {
    const modelPath = this.config.modelPath ?? process.env.MYMODEL_PATH
    if (!modelPath) {
      throw new Error('llm-mymodel: missing modelPath (config.modelPath hoặc MYMODEL_PATH)')
    }

    // TODO: load model thật ở đây (đồng bộ hoặc async — cả 2 đều hợp lệ,
    // [Service.init]() cho phép return 1 Promise<Disposable> nếu load
    // là async thật). Ví dụ đồng bộ:
    this.session = loadMyModelSomehow(modelPath) // <-- hàm thật của bạn
    this.ctx.logger('llm-mymodel').info('model loaded (%s)', modelPath)

    // BẮT BUỘC return hàm dọn dẹp — đây là chỗ Cordis tự gọi khi unmount
    // (hot-swap, shutdown...). Không return = leak (model vẫn giữ RAM/handle
    // sau khi bị gỡ).
    return () => {
      this.session?.close?.() // TODO: giải phóng đúng cách model bạn yêu cầu
      this.ctx.logger('llm-mymodel').info('model unloaded')
    }
  }

  async complete(messages: LlmMessage[], options: LlmCompleteOptions = {}): Promise<LlmCompletion> {
    // TODO: gọi vào this.session thật, map messages/options sang format
    // model bạn cần, map kết quả trả về đúng LlmCompletion.
    const result = await this.session.generate(messages)
    return { content: result.text, toolCall: undefined }
  }
}

export const apply = async (ctx: Context, config: LlmMyModel.Config = {}) => {
  await ctx.plugin(LlmMyModel, config)
}
```

**Nếu `[Service.init]()` của bạn là `async`** (load model mất thời gian
thật): viết `async [Service.init]() { ... }`, vẫn `return` hàm dọn dẹp ở
cuối — Cordis tự `await` đúng cách, không cần làm gì thêm.

---

## 4. Tool-calling — model của bạn có hỗ trợ hay không?

**Không hỗ trợ (model chat thuần)**: để `toolCall: undefined` luôn, không
làm gì thêm. Agent loop vẫn chạy bình thường, chỉ là model này sẽ không bao
giờ chủ động gọi tool nào — hoàn toàn hợp lệ, không phải lỗi.

**Có hỗ trợ (native function-calling, kiểu OpenAI-compatible)**: map
`options.tools` sang format model bạn cần trước khi gửi, parse tool call
từ response về đúng `LlmToolCall { name, args }`. Xem ví dụ thật đã build
trong `agent-core` (`bundles/providers/llm-deepseek/index.ts`) nếu cần đối
chiếu — cùng 1 pattern, chỉ khác tên field API.

**Đơn giản hoá được CHẤP NHẬN nhưng PHẢI ghi rõ trong comment, không âm
thầm bỏ qua**: nếu API tool-calling của model bạn yêu cầu round-trip id
phức tạp (`tool_call_id`) mà seam này không track, bạn được phép "hạ cấp"
message role `'tool'` thành role `'user'` có tiền tố khi gửi lên API thật
(để luôn là request hợp lệ) — đúng cách `llm-deepseek` đã làm, xem comment
đầu file đó để hiểu lý do.

---

## 5. Checklist trước khi giao lại file

- [ ] File nằm đúng chỗ: `bundles/providers/llm-<ten>/index.ts`
- [ ] Class kế thừa đúng `LlmService`, `complete()` đúng chữ ký
      `(messages, options?) => Promise<LlmCompletion>`
- [ ] `apply` là arrow function, có block body, và `async` nếu có resource
      bất đồng bộ thật (Rule 1-3 ở mục 2)
- [ ] Không hard-code secret — đọc từ `config` hoặc `process.env`
- [ ] Nếu model không hỗ trợ tool-calling: `toolCall` luôn `undefined`,
      KHÔNG throw khi `options.tools` có giá trị
- [ ] Nếu dùng Pattern B: `[Service.init]()` có return hàm dọn dẹp, đã tự
      test mount → unmount → xác nhận resource thật sự được giải phóng
      (không còn process/handle/connection sống sót)
- [ ] Đã tự chạy thử 1 lần thật (script nhỏ gọi `complete()` trực tiếp,
      không cần integrate vào agent loop) để chắc network/model call hoạt
      động trước khi giao — xem mẫu script ở mục 6

## 6. Tự verify trước khi giao (không bắt buộc có agent-core, chỉ cần Node + file này)

```typescript
// verify-mymodel.ts — chạy: npx tsx verify-mymodel.ts
import { Context } from '@deepseek-ai/cordis' // npm install @deepseek-ai/cordis TRƯỚC
import * as llmMyModel from './bundles/providers/llm-mymodel/index.ts'

const root = new Context()
await root.plugin(llmMyModel, { /* config thật để test */ })

const result = await root.llm.complete([{ role: 'user', content: 'xin chào' }])
console.log('KẾT QUẢ:', result)

await root.fiber.dispose() // xác nhận không throw, không treo — nghĩa là dọn dẹp sạch
console.log('OK — dispose sạch')
```

Nếu script này chạy in ra `KẾT QUẢ` đúng và `OK — dispose sạch` không lỗi/
không treo — file sẵn sàng giao lại.

---

## 7. Sau khi nhận lại file (việc của phía `agent-core`, không phải việc của bạn)

Ghi chú lại cho người tích hợp — không cần làm, chỉ cần biết:

1. Copy file vào `bundles/providers/llm-<ten>/index.ts` trong repo `agent-core`.
2. Thêm dependency (nếu model cần SDK riêng) vào `package.json`.
3. Trong `src/serve.ts`: đổi `import * as llmDeepseek from '../bundles/providers/llm-deepseek/index.ts'`
   thành provider mới, đổi dòng `root.plugin(llmDeepseek, {...})` tương ứng.
4. Chạy `npm run typecheck && npm test` — không có test riêng nào bắt buộc
   cho provider LLM mới (network call thật không chạy trong CI, đúng quy
   ước đã áp dụng cho `llm-deepseek`), miễn không làm gãy test hiện có.
