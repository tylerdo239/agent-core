# Plan — skill `business-case-builder`: kịch bản kinh doanh + KPI + 3 loại phân tích

## 0. Bối cảnh, xác nhận trước khi thiết kế

User: muốn 1 flow độc lập gắn vào agent-core, build bằng **skill** (không phải tool/provider mới) + dùng `tool_web_search` sẵn có, tạo ra kịch bản kinh doanh đầy đủ KPI và 3 loại phân tích (kinh doanh / khoa học / nội bộ).

Đọc lại 17 skill thật đang có trong `bundles/skills/` trước khi thiết kế (không đoán):

- **2 tầng rõ rệt**: skill top-level, `user-invocable` mặc định `true` khi KHÔNG set field này (`data-scientist`, `analyze`, `explore-data`, `validate-data` — hiện trong dropdown "Chọn skill") vs skill "thư viện phương pháp" đặt `user-invocable: false` (13 skill còn lại — `cohort-analysis`, `pandas-expert`, `statistical-analysis`...).
- `data-scientist` (skill gần nhất về tinh thần — quy trình data-science kỷ luật, có "Nguyên tắc bắt buộc", bảng phân luồng, workspace theo `{project-slug}`, script kèm JSON+Markdown output kép, bảng "Bản đồ tài liệu tham khảo") là **mẫu cấu trúc đúng nhất để theo** — 1 skill top-level, tự chứa toàn bộ `references/`/`checklists/`/`templates/`/`scripts/` riêng, KHÔNG tách thành nhiều skill con rời rạc.
- Xác nhận cơ chế nạp (`bundles/providers/skill-filesystem/index.ts`): `readdirSync(root)` quét **mọi** thư mục con của `bundles/skills/` lúc boot, không có danh sách cứng nào — thêm skill mới chỉ cần tạo thư mục, **không cần sửa `src/serve.ts`**, khác hẳn tool/provider (phải thêm dòng `mount()`).
- Chưa có skill nào dùng `web_search` — đây là điểm khác biệt chính của skill mới so với 17 skill hiện có (toàn bộ đều thao tác trên dữ liệu đã có sẵn trong workspace, không tự đi tra cứu ngoài).

## 1. Vị trí trong hệ thống

```
bundles/skills/business-case-builder/
├── SKILL.md
├── references/
│   ├── kpi-framework.md
│   ├── business-analysis-guide.md
│   ├── scientific-analysis-guide.md
│   ├── internal-analysis-guide.md
│   └── web-research-guide.md
├── templates/
│   └── business-scenario-report.md
├── checklists/
│   └── completeness-checklist.md
└── scripts/
    └── kpi_calculator.py        # tuỳ chọn, xem mục 5
```

`user-invocable` mặc định `true` (không set field) — skill này hiện trong dropdown "Chọn skill" như `data-scientist`. `inject`/wiring TS: **không có** — skill thuần Markdown, `skill-filesystem` tự phát hiện.

## 2. Nội dung `SKILL.md` — khung chính

Theo đúng khuôn `data-scientist`/`funnel-analysis`: frontmatter (`name`, `description` mô tả rõ khi nào kích hoạt), rồi:

- **Nguyên tắc bắt buộc** (mượn kỷ luật của `data-scientist`, áp cho bối cảnh kinh doanh):
  1. Mọi con số thị trường/đối thủ phải có nguồn từ `web_search` thật, trích dẫn URL — không tự ước lượng bằng "cảm giác". Không tìm được số liệu tin cậy → ghi rõ "chưa xác minh được, cần thu thập thêm", không bịa.
  2. Mọi KPI phải có: công thức, giá trị hiện tại/ước tính (kèm nguồn), mục tiêu, khung thời gian — thiếu 1 trong 4 là KPI chưa hoàn chỉnh.
  3. Mọi ước lượng tài chính đi kèm khoảng (best/base/worst case), không chỉ 1 con số điểm.
  4. Khuyến nghị luôn kèm đánh đổi định lượng — tư vấn, không quyết định hộ (đúng nguyên tắc đã có ở `data-scientist`).
- **Quy trình 5 bước**: (1) Định hình bối cảnh — ngành, mô hình kinh doanh, giai đoạn (ý tưởng/early-stage/scale); (2) Thu thập dữ liệu thị trường qua `web_search` (đọc `references/web-research-guide.md`); (3) Xây khung KPI (đọc `references/kpi-framework.md`); (4) Chạy 3 phân tích song song — kinh doanh/khoa học/nội bộ (đọc 3 file guide tương ứng); (5) Tổng hợp báo cáo theo `templates/business-scenario-report.md`, chạy `checklists/completeness-checklist.md` trước khi bàn giao.
- **Workspace**: `business-cases/{scenario-slug}/scenario-report.md` — cùng quy ước `{project-slug}` như `data-scientist` (`ds-workspace/{project-slug}/`).
- **Bản đồ tài liệu tham khảo** — bảng liệt kê 5 file `references/` + khi nào đọc, đúng format bảng `data-scientist` đã dùng.

## 3. Nội dung `references/kpi-framework.md` — khung KPI thật, có công thức

5 nhóm KPI, mỗi KPI có công thức + cách diễn giải (không phải danh sách tên suông):

1. **Growth/Revenue** — MRR/ARR, MoM growth rate, CAGR = (giá trị cuối/giá trị đầu)^(1/số năm) − 1.
2. **Customer** — CAC = chi phí marketing+sales ÷ khách hàng mới; LTV = ARPU × gross margin % ÷ churn rate; LTV:CAC ratio (ngưỡng tham khảo ≥ 3); churn rate; NPS.
3. **Financial/Unit economics** — gross margin, burn rate, runway = tiền mặt còn lại ÷ burn rate/tháng, CAC payback period = CAC ÷ (ARPU × gross margin %), break-even point.
4. **Operational** — tuỳ ngành (fulfillment time, utilization rate, defect rate...) — hướng dẫn CÁCH chọn thay vì liệt kê cứng, vì khác nhau theo mô hình kinh doanh.
5. **Product/Engagement** (nếu có sản phẩm số) — DAU/MAU, activation rate, retention curve (liên kết `references/statistical-analysis`/`time-series-analysis` — 2 skill data-science ĐÃ CÓ, không viết lại logic thống kê, chỉ trỏ tới).

Ghi rõ: chọn ĐÚNG tập con phù hợp mô hình kinh doanh, không liệt kê máy móc cả 5 nhóm cho mọi trường hợp (vd. B2B SaaS cần LTV:CAC, retail truyền thống cần inventory turnover — không có trong danh sách trên, agent tự bổ sung có căn cứ).

## 4. Nội dung 3 file guide phân tích

- **`business-analysis-guide.md`** — market sizing (TAM/SAM/SOM + công thức top-down/bottom-up), competitive positioning (đơn giản hoá Porter's 5 forces còn 3 câu hỏi thực dụng: rào cản gia nhập, quyền lực thương lượng khách hàng, mức độ cạnh tranh trực tiếp), business model/revenue model, go-to-market ngắn gọn.
- **`scientific-analysis-guide.md`** — áp kỷ luật định lượng của `data-scientist` vào bối cảnh business case: scenario modeling (best/base/worst, không chỉ 1 điểm), sensitivity analysis (biến nào ảnh hưởng kết quả nhiều nhất), forecasting nếu có chuỗi thời gian (trỏ `time-series-analysis`), hypothesis test nếu so sánh phương án (trỏ `statistical-analysis`) — **không viết lại kỹ thuật thống kê, chỉ điều phối** dùng skill đã có.
- **`internal-analysis-guide.md`** — SWOT có kỷ luật (mỗi mục phải cụ thể, có bằng chứng, không sáo rỗng kiểu "đội ngũ mạnh"), VRIO đơn giản hoá cho đánh giá năng lực nội bộ (Value/Rarity/Imitability/Organization — 4 câu hỏi), risk register (rủi ro × xác suất × tác động × biện pháp giảm thiểu), readiness checklist (nhân sự/tài chính/vận hành đã sẵn sàng chưa).
- **`web-research-guide.md`** — hướng dẫn RIÊNG cho use-case này (khác guidance chung `tool-web-search` đã tự chèn qua `ctx.prompts.section`): loại query nên chạy (quy mô thị trường, xu hướng ngành, định giá đối thủ, tin tức gần đây), số lần search hợp lý (tránh search tràn lan vô nghĩa), cách xử lý số liệu MÂU THUẪN giữa nhiều nguồn (nêu range, không tự chọn 1 số rồi giấu phần còn lại), luôn ghi rõ ngày/nguồn cạnh mỗi con số quan trọng trong báo cáo cuối.

## 5. `scripts/kpi_calculator.py` (tuỳ chọn nhưng nên có)

Theo đúng mẫu `data-scientist/scripts/profile_data.py`: nhận input nhỏ (JSON hoặc CSV các biến thô: doanh thu, chi phí marketing, khách hàng mới, churn...), tính sẵn các công thức ở mục 3 (CAC, LTV, LTV:CAC, burn rate, runway, CAGR, break-even), xuất SONG SONG 1 file Markdown (đọc được, chèn thẳng vào báo cáo) + 1 JSON (agent đọc lại để không tự tính nhầm trong đầu — đúng "Nguyên tắc bắt buộc #2" của `data-scientist`: mọi con số phải truy được về code đã chạy).

## 6. `templates/business-scenario-report.md` — khung báo cáo cuối

Executive Summary → Bối cảnh kinh doanh → **Khung KPI** (bảng: KPI, công thức, giá trị/ước tính, nguồn, mục tiêu) → **Phân tích kinh doanh** → **Phân tích khoa học** (kèm scenario best/base/worst) → **Phân tích nội bộ** (SWOT/VRIO/risk register) → Khuyến nghị (đánh đổi định lượng, không quyết định hộ) → Nguồn tham khảo (danh sách URL từ `web_search`, có ngày truy cập).

## 7. `checklists/completeness-checklist.md` — cổng trước khi bàn giao

- [ ] Mọi KPI có đủ 4 phần: công thức / giá trị / nguồn / mục tiêu?
- [ ] Mọi con số thị trường/đối thủ trích được URL nguồn thật (không có số nào "từ trí nhớ")?
- [ ] Cả 3 phần phân tích (kinh doanh/khoa học/nội bộ) đều có mặt, không phần nào là placeholder?
- [ ] Phân tích khoa học có khoảng best/base/worst, không chỉ 1 điểm ước lượng?
- [ ] Khuyến nghị có đánh đổi định lượng kèm theo, không phải kết luận suông?
- [ ] Số liệu mâu thuẫn giữa nguồn (nếu có) được nêu rõ range, không bị giấu?

## 8. Test + verify (theo đúng kỷ luật dự án — thật, không giả thuyết)

- Test mới `tests/skill-business-case-builder.test.ts` (mount `skillRegistry` + `skillFilesystem` thật qua `Context`, trỏ `root` vào `bundles/skills/`): xác nhận `ctx.skills.get('business-case-builder')` tồn tại, `userInvocable === true`, đủ 5 resource trong `references/` + 1 trong `templates/` + 1 trong `checklists/`, `readResource()` đọc đúng nội dung `kpi-framework.md`.
- Có `scripts/kpi_calculator.py` → thêm test Python độc lập (không cần Cordis) verify công thức đúng (vd. LTV:CAC với input mẫu ra đúng số kỳ vọng).
- **E2E thật qua Docker** (đúng kỷ luật mọi phase trước): 1 turn RLM chọn `selectedSkill: "business-case-builder"`, prompt kiểu "Xây kịch bản kinh doanh cho 1 startup SaaS B2B tại Việt Nam, dùng web search lấy dữ liệu thị trường thật" — xác nhận: skill được chọn đúng, `web_search` thực sự được gọi (đọc log/trace), báo cáo trả về có đủ bảng KPI + 3 phần phân tích + mục Nguồn tham khảo có URL thật.

## 9. Giới hạn, nói rõ trước (không che giấu)

- Đây là skill (hướng dẫn tĩnh chèn prompt), KHÔNG phải tool/provider mới — không có seam/`src/serve.ts` nào bị đụng, không có endpoint mới. Chất lượng đầu ra phụ thuộc model có tuân thủ instructions hay không (skill định hướng, không đảm bảo tuyệt đối).
- Khung KPI là template CHUNG — không tự nhận diện đúng loại hình kinh doanh để chọn KPI phù hợp 100%; instructions yêu cầu agent tự chọn tập con có căn cứ, không liệt kê máy móc.
- `web_search` hiện dùng DuckDuckGo scrape HTML (xem `bundles/tools/tool-web-search`) — không phải API thị trường chuyên dụng (Statista, CB Insights...), số liệu thu được có thể nông hơn báo cáo trả phí thật; guide sẽ nhắc rõ giới hạn này trong báo cáo cuối (không giả vờ số liệu sâu hơn thực tế).

---

Implement đi thì tôi làm theo đúng thứ tự: viết 5 file `references/` + `SKILL.md` trước (nội dung là phần tốn công nhất, cần đúng và đủ) → `templates/`+`checklists/` → `scripts/kpi_calculator.py` (nếu bạn muốn) → test mount thật → rebuild Docker + 1 turn RLM thật để verify.

## 10. ĐÃ IMPLEMENT VÀ VERIFY THẬT — kèm 1 lần sửa sai sau khi user phản hồi

Toàn bộ mục 1-9 đã build đúng như plan: `SKILL.md` + 5 file `references/` + 1
`templates/` + 1 `checklists/` + `scripts/kpi_calculator.py` (verify tay 14/14
công thức đúng, input thiếu báo rõ chứ không bịa số). Test
`tests/skill-business-case-builder.test.ts` mount `skillRegistry`+
`skillFilesystem` thật trỏ vào `bundles/skills/` — 3 test ban đầu pass.

### Sai lầm thật đã mắc: gắn nhầm skill vào RLM

Lần verify E2E đầu tiên (mục 8, dòng 88) chọn `selectedSkill` qua dropdown
"Chọn skill" — dropdown đó CHỈ hiện ở session driver `rlm` (UI-plugin
`packages/ui-rlm-workspace`, xem Phase 28). Kết quả: skill CHẠY ĐƯỢC, nhưng
chỉ dùng được qua session RLM — đúng thứ user đã nói rõ ngay từ đầu KHÔNG
muốn ("1 flow build thêm độc lập... tôi muốn tách ra"). Đây là lỗi thiết kế
thật của tôi, không phải giới hạn kỹ thuật của agent-core.

**Xác nhận gốc rễ trước khi sửa** (đọc code, không đoán):
`bundles/loop-drivers/loop-default/index.ts` dòng ~31 đã tự gọi
`runCtx.skills.match(userMessage)` (auto-trigger theo `triggers` frontmatter)
và expose TOÀN BỘ `runCtx.tools.list()` (gồm `web_search`) cho model — không
có gì ở tầng seam/backend ép skill phải gắn với RLM.
`bundles/skills/skill-support-tone` (skill ĐẦU TIÊN trong repo) là bằng
chứng sống: chạy hoàn toàn trong chat thường, chưa từng đụng RLM. Vấn đề
DUY NHẤT: `business-case-builder/SKILL.md` ban đầu không có field
`triggers:` trong frontmatter, nên chỉ kích hoạt được qua con đường RLM-only
(dropdown `selectedSkill`).

### Đã sửa

- Thêm `triggers:` vào frontmatter (`kịch bản kinh doanh`, `business case`,
  `phân tích kinh doanh`, `khung kpi`, `phân tích kpi`, `phân tích thị
  trường`, `kế hoạch kinh doanh`, `business plan`, `đánh giá cơ hội kinh
  doanh`) — tự kích hoạt qua `ctx.skills.match()` (so khớp substring
  case-insensitive) ở CẢ chat thường lẫn RLM, không cần chọn dropdown.
- `SKILL.md` thêm đoạn nói rõ ngay đầu: dùng được ở cả 2 loại session; CHỈ
  `scripts/kpi_calculator.py` phụ thuộc riêng Python REPL (chỉ RLM có) —
  không bắt buộc, chat thường thì tính công thức trực tiếp trong câu trả
  lời thay vì giả vờ đã chạy code không tồn tại.
- Test thêm 1 case xác nhận `match()` tự kích hoạt đúng theo từ khoá, không
  kích hoạt nhầm với tin nhắn không liên quan.

### Verify lại thật — lần này đúng yêu cầu tách khỏi RLM

`npm run typecheck` sạch, `npm test` 233/233 pass (41 file). Docker rebuild
+ **1 turn thật trong session `driver: "default"`** (tạo `POST /sessions {}`
— KHÔNG có `driver:"rlm"`, KHÔNG truyền `selectedSkill`): gửi tin nhắn chỉ
chứa từ khoá trigger ("xây kịch bản kinh doanh cho 1 quán cà phê...") — skill
tự kích hoạt, `web_search` được gọi THẬT (xác nhận qua `GET /sessions/:id/
events` — event `tool_result` thật, `name:"web_search"`, query + kết quả
thật từ BlueWeave Consulting), báo cáo trả về đủ bảng KPI + phân tích tài
chính best/base case + SWOT, đúng cấu trúc skill — hoàn toàn không chạm
RLM/Python REPL nào. Đây là bằng chứng thật, không phải suy luận từ đọc
code: skill giờ tách biệt khỏi RLM đúng yêu cầu ban đầu.
