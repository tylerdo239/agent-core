# Coding Rules — Agent Core trên Cordis

> Rút ra trực tiếp từ [`agent-core-cordis-build-plan.md`](./agent-core-cordis-build-plan.md). Đây là rule bắt buộc cho mọi PR chạm vào `seams/`, `bundles/`, hoặc agent loop — không phải gợi ý tuỳ chọn. Review sẽ chặn PR vi phạm các mục có nhãn **[BLOCKING]**.

---

## Phần A — Rule của Senior Software Engineer (kiến trúc & chất lượng code)

### A1. Seam-first — interface luôn đi trước implementation **[BLOCKING]**
- Mọi capability (`llm`, `storage`, `memory`, `permission`, `sandbox`, `tools`, `subagents`) phải có file trong `seams/` định nghĩa interface/abstract class **trước khi** viết provider đầu tiên.
- File seam không chứa logic implementation — chỉ contract (abstract methods, types).
- Build phải pass khi chưa mount provider nào. Nếu build đỏ vì thiếu implementation → seam đang lẫn logic vào, sai chỗ.

### A2. Kỷ luật effect — mọi side-effect đi qua `ctx.*`, không có ngoại lệ **[BLOCKING]**
- Cấm dùng trực tiếp `setInterval`/`setTimeout`/`addEventListener`/mở connection thô bên ngoài API của `ctx`.
- Lý do: Cordis chỉ rollback được thứ nó track. Một `setInterval` thô là leak tiềm ẩn, không phải style nit — coi nó như bug logic, không phải lint warning.

```typescript
// SAI — Cordis không biết interval này tồn tại, không tự huỷ khi unmount
export const apply = (ctx: Context) => {
  setInterval(() => checkHealth(), 5000)
}

// ĐÚNG — core @deepseek-ai/cordis KHÔNG có ctx.setInterval sẵn (đó là addon
// riêng ở bản OSS, chưa xác nhận có cho bản deepseek); bọc side-effect thô
// qua ctx.effect() để nó tự rollback đúng thứ tự khi fiber dispose.
export const apply = (ctx: Context) => {
  ctx.effect(() => {
    const id = setInterval(() => checkHealth(), 5000)
    return () => clearInterval(id)
  }, 'checkHealth interval')
}
```
- Checklist review: grep bundle mới cho `setInterval(`, `setTimeout(`, `addEventListener(`, `new WebSocket(`, `.connect(` không qua `ctx.effect()` — bất kỳ match nào ngoài factory/service constructor đều phải giải trình.

### A3. `inject` là hợp đồng — khai báo đủ, không thiếu, không thừa **[BLOCKING]**
- Mọi bundle khai báo `inject: [...]` phản ánh **chính xác** những `ctx.<key>` nó dùng trong `apply()`. Không dùng ctx.storage mà quên khai báo `storage` trong inject = bug (activate sai thời điểm, có thể crash khi storage chưa sẵn sàng).
- Không import trực tiếp implementation của service khác để né `inject` — nếu cần capability gì, khai báo qua seam, không side-channel qua import.

### A4. Lifecycle đối xứng — mở resource và dọn resource viết cạnh nhau, review cùng lúc **[BLOCKING]**
- `Service` KHÔNG có `start()`/`stop()` built-in (pseudocode trong plan gốc dùng tên này nhưng không phải API thật — đã verify trên `@deepseek-ai/cordis@4.0.1`). Pattern thật: class kế thừa `Service` dùng trực tiếp làm plugin (`ctx.plugin(MyService)`) thì viết method `[Service.init]()` — mở resource ở đầu, **return** 1 hàm dọn dẹp ở cuối cùng method đó. Cordis tự đăng ký hàm trả về làm effect của đúng fiber sở hữu plugin.
- Hàm dọn dẹp trả về từ `[Service.init]()` phải undo chính xác những gì phần đầu method làm (đóng connection, clear cache, unregister). Không dựa vào GC để dọn dẹp.
- Test bắt buộc cho mỗi provider: mount → unmount → assert resource đã sạch (connection closed, timer cleared) — đúng pattern deliverable Phase 2.

### A5. Ghim version cho dependency chưa ổn định **[BLOCKING]**
- `@deepseek-ai/cordis` và `@deepseek-ai/dsh-mcp-client` ghim version chính xác trong `package.json` — **không dùng `^`**. Đây là cảnh báo chính thức từ upstream, không phải thận trọng thừa.
- Đọc CHANGELOG trước khi bump version của 2 package này; kiểm tra tương thích version giữa chúng.

### A6. Không build hạ tầng thừa ngoài scope của plan
- Không tự chế generic plugin loader, generic seam registry, hay bất kỳ abstraction nào không nằm trong bảng seam ở Phase 1. YAGNI áp dụng kể cả khi đang build framework.
- Nếu thấy cần 1 seam mới không có trong bảng gốc → cập nhật bảng trong plan trước, không âm thầm thêm `ctx.<key>` mới.

### A7. Test bắt buộc theo từng phase — không nhảy phase khi thiếu deliverable test **[BLOCKING]**
| Phase | Test bắt buộc trước khi coi là "xong" |
|---|---|
| 1 | Build pass với 0 provider |
| 2 | Mount → unmount → 0 resource leak (connection/timer) |
| 3 | ≥3 cặp dependency thật có test suspend/resume (tool↔storage, subagent↔permission, loop↔llm) |
| 4 | 1 turn end-to-end pass thật (model → tool → storage) |
| 5 | Chaos hot-swap test pass nhiều lần liên tiếp, `--detectOpenHandles` sạch |

Code tồn tại không đồng nghĩa phase xong — thiếu test deliverable = chưa xong, kể cả khi "chạy được bằng tay".

**Lưu ý khi viết test dùng `fiber.await()`:** `fiber.await()` CHỈ đợi công việc load ĐANG CHẠY DỞ (`this.inertia`) — nếu tại thời điểm gọi, fiber đó vẫn PENDING (dependency từ các bundle mount trước đó trong CÙNG test chưa kịp hội tụ qua vài vòng microtask), `inertia` chưa từng được set nên `.await()` resolve NGAY LẬP TỨC mà không đợi gì — silent, không throw, không cảnh báo. Đã verify thực nghiệm (gây ra 1 test REST flaky thật khi build Phase 6, không phải giả thuyết). Sau khi mount nhiều bundle phụ thuộc lẫn nhau trong test, dùng `await settle()` (1 tick `setTimeout` thật — pattern đã dùng xuyên suốt từ Phase 3) để cho toàn bộ chuỗi reactive hội tụ TRƯỚC, rồi mới `fiber.await()` nếu cần — không dùng `fiber.await()` một mình làm cơ chế đồng bộ hoá duy nhất khi fiber đó còn `inject` phụ thuộc bundle khác.

### A8. Không tự viết try/catch phòng thủ quanh dependency thiếu
- Spatial composability (mục A3) đã tự lo việc A-cần-B-mất-B. Nếu thấy code có try/catch bọc quanh việc gọi `ctx.<service>` phòng trường hợp nó chưa sẵn sàng → dấu hiệu `inject` khai sai/thiếu, sửa `inject`, không thêm try/catch.

### A9. Thuật ngữ đúng theo upstream
- Dùng **"fiber"** (không phải "fork scope") trong code, log, comment, PR description — khớp đúng API/docs thật của Cordis, tránh tự chế jargon riêng gây khó tra cứu khi debug qua issue/docs upstream.

### A10. Plugin dạng hàm (`apply`) LUÔN viết bằng arrow function, không dùng function declaration **[BLOCKING]**
- `function apply(ctx) {...}` (function declaration/function expression thường) có `.prototype` → Cordis coi nó là constructor và gọi bằng `new`. Nếu thân hàm `return` 1 disposer trực tiếp (không bọc qua `ctx.effect()`), disposer đó **bị nuốt mất trong im lặng** — không bao giờ chạy khi fiber dispose. Đã verify thực nghiệm (named function vs arrow function, so sánh output thật), không phải suy đoán từ đọc source.
- **Luôn** viết `export const apply = (ctx: Context, config?: X) => {...}` (arrow function) hoặc method shorthand trong object plugin (`{ apply(ctx) {...} }`) — cả hai đều không có `.prototype`, được Cordis gọi trực tiếp (không qua `new`), effect trả về được xử lý đúng qua `_execute()`.
- Class dùng làm plugin (`ctx.plugin(SomeServiceClass)`) thì NGƯỢC LẠI — phải là class thật (có `.prototype`) để Cordis `new` đúng và gọi `[Service.init]()`; rule này chỉ áp dụng cho plugin dạng hàm.
- Review checklist: grep `bundles/**` cho `export function apply` — bất kỳ match nào là vi phạm, phải sửa thành arrow function.

### A11. Arrow function dùng làm plugin PHẢI có block body `{ }`, không dùng expression body **[BLOCKING]**
- `ctx => ctx.plugin(X)` (expression body, return ngầm) trả về Fiber handle (có `.then`, giống PromiseLike) — Cordis hiểu nhầm giá trị này là 1 Effect cần `await` rồi collect; khi promise đó resolve ra chính Fiber instance (không phải function/iterable hợp lệ), `safeCollect()` throw `TypeError: Invalid effect`, khiến CẢ fiber cha fail và mọi service nó cung cấp biến mất theo — lỗi lan xa hơn nhiều so với chỗ gây ra nó. Đã verify thực nghiệm (không phải suy đoán) khi viết test Phase 4: `root.plugin((ctx) => ctx.plugin(BadCallLlm))` làm `loop-default` tự unload dù không liên quan trực tiếp.
- **Luôn** viết `(ctx: Context) => { ctx.plugin(X) }` — dấu `{ }` khiến function trả về `undefined` (rơi ra cuối block), không phải giá trị của statement cuối. Áp dụng cho MỌI lệnh gọi `ctx.plugin()`, `ctx.effect()`, `ctx.provide()`, `ctx.tools.add()`, ... ở vị trí cuối thân hàm.
- Review checklist: grep `bundles/**` và test cho pattern `=> ctx.` (mũi tên rồi gọi thẳng `ctx.` không qua dấu `{`) — bất kỳ match nào phải xác nhận không phải implicit-return của 1 lệnh gọi ctx.*.

### A12. Handler đăng ký vào 1 registry hot-swappable KHÔNG được đóng gói (closure) `ctx` của chính fiber đăng ký nó — phải nhận `ctx` ổn định qua tham số **[BLOCKING]**
- Bất kỳ `ctx.<registry>.register(name, handler)` nào (loop driver, tool, subagent, ...) mà chính fiber đăng ký handler đó có thể bị dispose ĐỘC LẬP với vòng đời lúc handler đang chạy (vd. hot-swap Phase 5) — handler KHÔNG được dùng `ctx` đóng gói từ `apply(ctx)` của chính nó để gọi service khác bên trong. Fiber dispose thì `fiber.store = undefined`; mọi `ctx.<service>` gọi tiếp sau đó từ closure đó **throw** `"cannot get required service ... in inactive context"` — kể cả khi service đó vẫn đang chạy tốt ở nơi khác trong hệ thống. Đã verify thực nghiệm (script so sánh closure-ctx vs ctx-truyền-qua-tham-số) trước khi build Phase 5.
- Cách đúng: handler nhận `ctx` như 1 THAM SỐ tường minh (`runTurn(runCtx, ...)`, không phải closure), do 1 caller ỔN ĐỊNH (không bị swap) truyền vào NGAY LÚC GỌI — không phải lúc đăng ký. Xem `seams/agent.ts` / `bundles/providers/agent-runner`: caller pin handler cụ thể (không phải "cái tên") ngay khi bắt đầu 1 tác vụ dài hạn, nên registry đổi handler đứng sau tên đó giữa chừng không ảnh hưởng tác vụ đang chạy — đây chính là cơ chế đứng sau coding rule B4.
- Ngược lại: bundle CHỈ ĐĂNG KÝ (không tự chạy logic dùng service khác trong `apply()`) không cần khai `inject` cho những service đó — chỉ caller ổn định mới cần.

### A13. Nếu `apply()` mở resource bất đồng bộ thật (server, connection…), `apply` PHẢI là `async` và return disposer TRỰC TIẾP — không gọi `ctx.plugin()`/`ctx.effect()` rồi bỏ đó không await **[BLOCKING]**
- `runtime.execute()` coi giá trị TRẢ VỀ của `apply(ctx, config)` là effect của CHÍNH fiber đó. Nếu `apply` đồng bộ chỉ *gọi* `ctx.plugin(SomeClass, config)` hoặc `ctx.effect(async () => {...})` mà không `await`/`return` nó, `apply()` trả về `undefined` gần như ngay lập tức — fiber bao ngoài coi như "đã load xong" TRƯỚC KHI resource bất đồng bộ bên trong thật sự sẵn sàng. `await fiber.await()` ở nơi gọi resolve sớm, đọc phải state chưa hoàn tất (vd. cổng server chưa gán, connection chưa mở). Đã verify thực nghiệm 2 lần độc lập (1 lần cho `ctx.effect()` không await, 1 lần cho `ctx.plugin(Class)` không await) — không phải suy đoán.
- Cách đúng — 2 pattern hợp lệ, chọn 1:
  1. `apply` là `async`, tự làm việc trực tiếp (mở server, v.v.), `return` 1 disposer (hoặc `Promise` của disposer) ở cuối — xem `bundles/adapters/api-rest`.
  2. `apply` là `async`, `await ctx.plugin(SomeClass, config)` — xem `bundles/providers/state-sqlite`, `bundles/providers/tool-registry`, và mọi bundle chỉ mount 1 class khác.
- Rủi ro tinh vi nhất: pattern SAI này "trông vẫn chạy được" nếu resource mở đồng bộ (vd. `better-sqlite3`, không có I/O thật chờ) — chỉ lộ ra khi ai đó đổi sang resource có I/O thật (network, Postgres, HTTP server...). Không dựa vào việc "test hiện tại pass" để kết luận pattern đúng — kiểm tra trực tiếp: `apply` có `async` và có `return`/`await` connect tới resource hay không.

### A14. Provider giữ state sống lâu hơn 1 request phải có câu trả lời cho "cái gì khiến nó không lớn vô hạn" **[BLOCKING]**
- Bất kỳ provider nào giữ state in-memory (Map, array, cache...) hoặc ghi liên tục xuống đĩa (SQLite, file log...) mà KHÔNG có TTL/eviction/retention nào — dù chỉ 1 request cũng append thêm — là 1 memory/disk leak tiềm ẩn, không phải "tối ưu sau". Phát hiện qua audit production-readiness thật trên bản deploy Docker chạy với LLM/search thật (Phase 8): `session-registry` (Map session vĩnh viễn), `Session.history` (gửi toàn bộ lịch sử mỗi turn, không cap), `state-sqlite` (bảng `events` không retention) — cả 3 đều "chạy đúng" trong test ngắn và demo, chỉ lộ ra sau nhiều ngày/nhiều request thật.
- Trước khi merge provider mới giữ state: trả lời rõ 1 trong 2 — (a) có cơ chế TTL/eviction/retention thật (dẫn tới đúng chỗ trong code), hoặc (b) state đó có giới hạn tự nhiên không cần cơ chế riêng (vd. bị giới hạn bởi 1 request/response, không tồn tại ngoài phạm vi đó) — ghi rõ lý do trong PR, không im lặng bỏ qua.
- Không bắt buộc phải là cơ chế phức tạp — sliding window (Phase 8.2), TTL trượt theo hoạt động qua `ctx.effect()` sweep định kỳ (Phase 8.1, 8.4) đều là giải pháp hợp lệ, đúng mức YAGNI cho gap cụ thể đã phát hiện, không cần xây hệ thống retention tổng quát nếu chưa có nhu cầu thật thứ 2.

### A15. UI-plugin đăng ký vào `ctx.slots` phải bọc disposer qua `ctx.effect()`, và mọi slot `keyed` bắt buộc có fallback tại nơi render **[BLOCKING]**
- Cùng nguyên tắc A2 (mọi side-effect qua `ctx.*`) áp dụng cho seam `ctx.slots` (Phase 9): `ctx.slots.register(...)` trả về 1 disposer, PHẢI được gắn qua `ctx.effect(() => ctx.slots.register(...))` trong bundle đăng ký — fiber đó unmount thì entry tự rút, không dựa vào ai dọn tay.
- Nơi render (`RenderSlot`/tương đương) của MỌI slot kind `keyed` bắt buộc nhận 1 `fallback` component tường minh, không có mặc định ngầm ẩn trong thư viện — 1 tool không có UI-plugin (hoặc UI-plugin bị unmount do hot-swap) không được phép làm crash cả trang, phải rơi về fallback (`GenericToolCard`) đúng như dsh (`ToolDefinition.ui` từ Phase 8.5 là nguồn dữ liệu của fallback, không bị Phase 9 vứt bỏ).
- **Không đủ nếu chỉ có fallback cho "không có entry"** — component ĐÃ đăng ký (hoặc chính `fallback`) vẫn có thể THROW lúc render (dữ liệu `result` sai hình dạng, bug trong UI-plugin của tool khác...). Gap thật phát hiện qua audit (đối chiếu `docs/agent-core-master-summary.md`, không phải suy đoán): trước khi có `SlotErrorBoundary`, 1 lỗi render như vậy lan ra tới React root, crash TRẮNG TOÀN BỘ trang, không chỉ đúng 1 tool-row. `RenderSlot` PHẢI tự bọc `Component`/`fallback` trong 1 Error Boundary (React class component — không có hook tương đương `componentDidCatch`), hiện 1 node tĩnh không nhận props khi bắt được lỗi (không gọi lại code người khác viết, tránh throw lặp).

### A16. UI-plugin mount tường minh trong `apps/web`, không auto-discover
- `apps/web/src/client-context.ts` import + `ctx.plugin(...)` liệt kê rõ từng UI-plugin — không quét thư mục/`package.json` để tự tìm plugin nào cần mount. Lý do: nhất quán với cách `src/serve.ts` đã mount bundle server-side (explicit import + explicit `root.plugin(...)`) — 1 repo không nên có 2 triết lý mount khác nhau giữa client và server.

### A17. Tool/provider gọi network ngoài PHẢI có timeout tường minh **[BLOCKING]**
- Gap thật phát hiện qua audit đối chiếu `docs/agent-core-master-summary.md` (mục "Resilience — timeout riêng từng tool"): `tool-web-search` gọi `fetch()` tới DuckDuckGo KHÔNG có `AbortController`/timeout nào — nếu bên ngoài treo, cả turn treo theo vô thời hạn, không có gì tự cắt. Không phải giả thuyết — tool này "chạy đúng" trong mọi test/demo trước đó chỉ vì DuckDuckGo luôn phản hồi nhanh, đúng dạng bug A14 mô tả (chỉ lộ khi điều kiện xấu xảy ra thật, không lộ trong test ngắn).
- Mọi tool/provider gọi `fetch`/network client ra ngoài Cordis process (HTTP, DB driver không tự có timeout...) phải có `AbortController` + `setTimeout` (xem `bundles/providers/llm-qwen` — mẫu đã có từ Phase 8.3 — và `bundles/tools/tool-web-search` sau audit fix) hoặc dựa vào timeout tích hợp sẵn của client library (ghi rõ trong code nếu vậy, không im lặng giả định "chắc nó có sẵn").
- Timeout nên là config tuỳ chọn qua provider config (`timeoutMs`), có default hợp lý theo bản chất lời gọi (LLM cần lâu hơn network call thường — 60s vs 10s là ví dụ thật trong repo), không hardcode 1 giá trị chung cho mọi loại network call.

---

## Phần B — Rule của AI Engineer (đặc thù agent)

### B1. Tool/subagent chạm dữ liệu nhạy cảm phải inject `permission` và check trước khi chạy **[BLOCKING]**
- Không giả định caller đã check quyền hộ. Bất kỳ tool/subagent nào đụng DB, filesystem, network ngoài đều tự kiểm tra qua `ctx.permission.check(...)` trong chính nó.

### B2. Sandbox boundary phải tường minh, không giả định có sẵn
- MCP/tool Python **không tự động được sandbox**. Ai thêm tool chạy code Python phải hoặc wire qua `ctx.sandbox`, hoặc ghi rõ trong PR description lý do tại sao không cần — không được im lặng bỏ qua.

### B3. Agent loop ghi state vào `ctx.storage` trước/ngay sau mỗi bước, không giữ state chỉ trong memory
- `model_message` và `tool_result` phải append vào storage seam theo đúng thứ tự xảy ra — đây là điều kiện để session phục hồi được và để hot-swap loop driver (Phase 5) không làm mất turn đang chạy dở.

### B4. Turn đang chạy phải pin đúng loop bundle lúc nó bắt đầu **[BLOCKING]**
- Khi swap `loop-default` → `loop-planner-critic` giữa lúc có turn khác đang chạy: turn cũ chạy hết bằng loop cũ, turn mới dùng loop mới. Cấm để 1 turn đổi chiến lược reasoning giữa chừng một cách âm thầm.
- Cơ chế thật (đã build ở Phase 5, không chỉ là ý định): entrypoint chạy turn (`ctx.agent.runTurn`, `bundles/providers/agent-runner`) tra driver từ `ctx.loop` **1 lần duy nhất** ngay khi bắt đầu turn, giữ tham chiếu cụ thể tới driver đó cho suốt turn — không tra lại registry ở mỗi bước. Đây cũng chính là lý do cần rule A12 (driver không được tự đóng gói `ctx` của chính nó).

### B5. Model provider luôn qua seam `ctx.llm`, cấm import SDK provider trực tiếp trong tool/subagent/loop **[BLOCKING]**
- Đổi deepseek ↔ openai ↔ provider khác phải là đổi config/bundle, không phải sửa code nghiệp vụ.

### B6. Prompt assembly tập trung ở 1 chỗ (`session.buildPrompt()` hoặc tương đương)
- Tool/loop code không tự ráp prompt string rải rác nhiều nơi — mọi thay đổi cách build prompt sửa 1 chỗ, dễ audit, dễ test.

### B7. Mọi tool/subagent activate phải log qua `ctx.logger(<bundle-name>)`
- Bắt buộc để debug được lúc nào 1 tool bị Cordis tự suspend/resume do spatial composability trong production — không có log này thì hành vi tự suspend rất khó phân biệt với bug.

### B8. Trước khi viết tool mới — hỏi "seam nào cần" trước khi hỏi "code thế nào"
- Kiểm tra bảng seam ở Phase 1 (`llm`/`storage`/`memory`/`tools`/`permission`/`sandbox`/`subagents`) có seam nào đã cover chưa. Không tự tạo `ctx.<random-key>` mới ngoài bảng mà không cập nhật seam definition trước.

---

## Phần C — Definition of Done cho mọi PR bundle/seam mới

- [ ] Seam interface tồn tại trong `seams/` trước khi có provider (A1)
- [ ] `inject` khớp chính xác với `ctx.<key>` thực dùng trong `apply()` (A3)
- [ ] `[Service.init]()` (hoặc `ctx.effect()`) mở/dọn resource đối xứng, không leak (A4)
- [ ] Test deliverable của phase tương ứng pass (A7)
- [ ] Grep sạch — không side-effect thô ngoài `ctx.*` (A2)
- [ ] Plugin dạng hàm dùng arrow function, không `function apply(){}` (A10)
- [ ] Arrow function plugin dùng block body `{ }`, không implicit-return `ctx.*` (A11)
- [ ] Handler đăng ký vào registry hot-swappable nhận `ctx` qua tham số, không đóng gói `ctx` của chính fiber đăng ký nó (A12)
- [ ] Nếu `apply()` mở resource bất đồng bộ thật: `apply` là `async`, `await`/`return` đúng effect (A13)
- [ ] Nếu provider giữ state sống lâu hơn 1 request: có TTL/eviction/retention thật, hoặc lý do state đó tự giới hạn ghi rõ trong PR (A14)
- [ ] UI-plugin đăng ký `ctx.slots` bọc disposer qua `ctx.effect()`, slot `keyed` có fallback tường minh tại nơi render, nơi render bọc Error Boundary cho lỗi runtime (A15)
- [ ] UI-plugin mount tường minh trong `apps/web/src/client-context.ts`, không auto-discover (A16)
- [ ] Nếu gọi network ngoài: có `AbortController`/timeout tường minh, không dựa vào "chắc nó nhanh" (A17)
- [ ] Logger scoped đúng theo tên bundle (B7)
- [ ] Nếu chạm dữ liệu nhạy cảm: có `ctx.permission` check (B1)
- [ ] Nếu chạm code Python/MCP: có `ctx.sandbox` hoặc lý do ghi rõ tại sao không (B2)
- [ ] Không import SDK provider LLM trực tiếp — chỉ qua `ctx.llm` (B5)

---

## Cách enforce (gợi ý, không phải yêu cầu ngay)

- Thêm CI step grep cho raw `setInterval(`/`setTimeout(`/`addEventListener(` trong `bundles/**` không nằm trong constructor của Service — fail build nếu match (hỗ trợ A2).
- Thêm script kiểm tra `inject` khai báo khớp AST usage thực tế của `ctx.<key>` trong mỗi bundle (hỗ trợ A3) — có thể để dạng lint rule custom khi có thời gian, không block ngay từ đầu.
- PR template thêm checklist Phần C ở trên để reviewer tick trực tiếp.
