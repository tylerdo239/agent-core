---
name: business-case-builder
description: Xây dựng kịch bản kinh doanh đầy đủ — khung KPI có công thức, phân tích kinh doanh (thị trường/cạnh tranh/mô hình doanh thu), phân tích khoa học (định lượng có căn cứ, kịch bản best/base/worst) và phân tích nội bộ (SWOT/năng lực/rủi ro). Dùng khi người dùng cần xây business case, đánh giá cơ hội kinh doanh mới, chuẩn bị pitch cho nhà đầu tư/stakeholder, hoặc cần 1 bộ KPI + phân tích đầy đủ để ra quyết định kinh doanh. Có dùng web search để lấy dữ liệu thị trường/đối thủ thật.
triggers: kịch bản kinh doanh, business case, phân tích kinh doanh, khung kpi, phân tích kpi, phân tích thị trường, kế hoạch kinh doanh, business plan, đánh giá cơ hội kinh doanh, tình hình kinh doanh, hiện trạng kinh doanh, thực trạng kinh doanh, báo cáo kinh doanh, chiến lược kinh doanh, mô hình kinh doanh, hoạt động kinh doanh, phát triển kinh doanh, cơ hội kinh doanh, rủi ro kinh doanh, ý tưởng kinh doanh, dự án kinh doanh, đánh giá kinh doanh, phân tích doanh nghiệp, tình hình doanh nghiệp, chiến lược doanh nghiệp, kế hoạch phát triển, lập kế hoạch kinh doanh, xây dựng kế hoạch, khởi nghiệp, business model, business strategy, business report, business analysis, market analysis, market research, startup idea, phân tích swot, swot
---

# Business Case Builder

Xây 1 kịch bản kinh doanh hoàn chỉnh — không phải liệt kê ý tưởng suông, mà là
1 tài liệu ra quyết định được: có khung KPI đo được, có số liệu thị trường
thật (qua `web_search`), có phân tích định lượng kèm bất định, và có đánh giá
năng lực nội bộ trung thực.

**Bạn tư vấn; người dùng quyết định.** Kết thúc bằng khuyến nghị kèm đánh đổi
đã định lượng, không tự chọn phương án thay người dùng.

**Dùng được ở cả 2 loại session** — kích hoạt tự động theo từ khoá (`triggers`
ở frontmatter) trong chat thường (driver mặc định), hoặc chọn tường minh qua
dropdown "Chọn skill" trong session "Phân tích dữ liệu" (driver `rlm`). Chỉ 1
phần PHỤ THUỘC riêng vào session RLM: `scripts/kpi_calculator.py` cần Python
REPL (chỉ RLM có) — xem "Script đi kèm" bên dưới, KHÔNG bắt buộc để hoàn thành
1 kịch bản.

## Nguyên tắc bắt buộc

Những quy tắc này có ưu tiên cao hơn mọi nội dung khác trong skill:

1. **BẮT BUỘC gọi `web_search` trước khi viết bất kỳ nhận định nào về tình
   hình/hiện trạng/thị trường/đối thủ/ngành — không có ngoại lệ, kể cả khi
   người dùng không hỏi trực tiếp về số liệu.** "Phân tích tình hình kinh
   doanh", "đánh giá hiện trạng", "báo cáo kinh doanh" đều là yêu cầu cần dữ
   liệu thật, không phải yêu cầu viết 1 khung lý thuyết chung chung dựa trên
   kiến thức nền. Tự nhận "kết hợp dữ liệu thực tế" mà KHÔNG thực sự gọi
   `web_search` là gian dối với người dùng — lỗi nghiêm trọng nhất của skill
   này. Không tìm được số liệu tin cậy → ghi rõ "chưa xác minh được qua tìm
   kiếm, cần thu thập thêm", không bịa số cũng không im lặng bỏ qua.
   Mọi số liệu thị trường/đối thủ trong báo cáo phải kèm URL nguồn và ngày.
2. **Mọi KPI phải đủ 4 phần**: công thức, giá trị hiện tại/ước tính (kèm
   nguồn), mục tiêu, khung thời gian. Thiếu 1 trong 4 là KPI chưa hoàn chỉnh —
   không liệt kê tên KPI suông.
3. **Mọi ước lượng định lượng đi kèm khoảng, không chỉ 1 điểm.** Doanh thu dự
   kiến, quy mô thị trường, chi phí — luôn ở dạng best/base/worst case (xem
   `references/scientific-analysis-guide.md`), không phải 1 con số điểm nghe
   chắc chắn giả tạo.
4. **Không liệt kê máy móc toàn bộ khung KPI/framework cho mọi trường hợp.**
   Chọn đúng tập con phù hợp mô hình kinh doanh cụ thể (SaaS B2B khác retail
   khác marketplace) và giải thích vì sao chọn — xem
   `references/kpi-framework.md` mục "Chọn đúng tập con".
5. **Số liệu mâu thuẫn giữa các nguồn phải được nêu rõ range, không được tự
   chọn 1 số rồi giấu phần còn lại.** Xem `references/web-research-guide.md`.
6. **Reasoning phải sâu, không dừng ở dán lại kết quả search.** Tối thiểu
   2-3 lượt `web_search` khác góc độ (quy mô thị trường, xu hướng, đối thủ)
   cho 1 yêu cầu "phân tích"/"báo cáo"/"lên kế hoạch" đầy đủ — 1 lượt search
   rồi kết luận ngay là nông. Mỗi kết luận phải nối rõ ràng với bằng chứng
   ("vì <số liệu/nguồn X> nên suy ra <kết luận Y>"), không liệt kê song song
   dữ liệu thô và nhận định mà không nối logic giữa 2 thứ đó. Đối chiếu
   chéo khi có thể (2 nguồn cùng nói 1 điều → kết luận chắc hơn; 2 nguồn mâu
   thuẫn → xem rule #5).

Luôn áp 1 phép kiểm tra cho mọi phần phân tích: **"Thì sao?"** — nếu 1 phát
hiện không ảnh hưởng đến quyết định hay hành động nào, nó không thuộc về sản
phẩm bàn giao.

## Quy trình 5 bước

1. **Định hình bối cảnh** — xác định: ngành, mô hình kinh doanh (SaaS/
   marketplace/retail/dịch vụ...), giai đoạn (ý tưởng/early-stage/scale), và
   quyết định cụ thể mà kịch bản này phục vụ (gọi vốn? mở rộng thị trường?
   đánh giá tính khả thi?). Câu hỏi mơ hồ ("phân tích kinh doanh cho tôi") cần
   hỏi lại phạm vi trước khi bắt đầu tìm kiếm, tránh lãng phí search vào sai
   hướng.
2. **Thu thập dữ liệu thị trường** — dùng `web_search` để lấy quy mô thị
   trường, xu hướng ngành, định giá/động thái đối thủ, tin tức gần đây. Đọc
   `references/web-research-guide.md` trước khi bắt đầu tìm kiếm — có hướng
   dẫn loại query nên chạy và cách xử lý số liệu mâu thuẫn.
3. **Xây khung KPI** — chọn tập KPI phù hợp mô hình kinh doanh, mỗi KPI đủ 4
   phần theo Nguyên tắc #2. Đọc `references/kpi-framework.md`.
4. **Chạy 3 phân tích** — kinh doanh, khoa học, nội bộ, đọc đúng 3 file guide
   tương ứng trước khi viết:
   - `references/business-analysis-guide.md` — market sizing, cạnh tranh, mô
     hình doanh thu, go-to-market.
   - `references/scientific-analysis-guide.md` — kịch bản định lượng best/
     base/worst, sensitivity analysis, và khi nào cần trỏ sang
     `statistical-analysis`/`time-series-analysis` (2 skill data-science đã
     có sẵn trong hệ thống — không viết lại kỹ thuật thống kê ở đây).
   - `references/internal-analysis-guide.md` — SWOT có bằng chứng, VRIO đơn
     giản hoá, risk register, readiness checklist.
5. **Tổng hợp báo cáo** — dùng khung `templates/business-scenario-report.md`,
   rồi chạy `checklists/completeness-checklist.md` trước khi bàn giao. Một
   kịch bản chưa qua checklist thì chưa hoàn thành.

## Workspace

```
business-cases/{scenario-slug}/
  scenario-report.md     # sản phẩm cuối, dựa trên templates/business-scenario-report.md
  kpi-inputs.json        # input thô cho scripts/kpi_calculator.py (nếu có số liệu tài chính cụ thể)
  kpi-computed.md         # output scripts/kpi_calculator.py — Markdown chèn thẳng vào báo cáo
  kpi-computed.json       # output scripts/kpi_calculator.py — agent đọc lại, không tự tính nhầm trong đầu
```

`{scenario-slug}` đặt theo tên rút gọn của kịch bản (vd. `saas-b2b-crm-vn`).
Không có script nào cũng được — với kịch bản còn ở giai đoạn ý tưởng, chưa có
số liệu tài chính cụ thể, chỉ cần `scenario-report.md`.

## Script đi kèm (chỉ dùng được trong session RLM — có Python REPL)

`scripts/kpi_calculator.py` — nhận input JSON các biến thô (doanh thu, chi phí
marketing, khách hàng mới, churn rate...), tính sẵn CAC/LTV/LTV:CAC/burn
rate/runway/CAGR/break-even theo đúng công thức ở
`references/kpi-framework.md`, xuất song song 1 file Markdown (chèn thẳng vào
báo cáo) và 1 JSON (đọc lại để không tự tính nhầm trong đầu — đúng Nguyên tắc
bắt buộc #2 ở trên, mọi con số phải truy được về code đã chạy, không tự nhẩm):

```bash
python {skill-dir}/scripts/kpi_calculator.py kpi-inputs.json --out business-cases/saas-b2b-crm-vn
```

Chỉ chạy khi có số liệu tài chính cụ thể để tính — kịch bản giai đoạn ý tưởng
thuần định tính thì bỏ qua bước này. **Đang ở chat thường (không phải session
"Phân tích dữ liệu")**: không có Python REPL để chạy script này — tính công
thức trực tiếp bằng phép tính trong câu trả lời (nêu rõ công thức + số liệu
đầu vào ngay cạnh kết quả, để người đọc tự kiểm tra được), không giả vờ đã
chạy code khi thực ra không có REPL nào tồn tại.

## Bản đồ tài liệu tham khảo

| File | Khi nào đọc |
|---|---|
| `references/kpi-framework.md` | Trước khi xây khung KPI (bước 3) |
| `references/business-analysis-guide.md` | Trước khi viết phần Phân tích kinh doanh |
| `references/scientific-analysis-guide.md` | Trước khi viết phần Phân tích khoa học, hoặc bất kỳ ước lượng định lượng nào |
| `references/internal-analysis-guide.md` | Trước khi viết phần Phân tích nội bộ |
| `references/web-research-guide.md` | Trước khi bắt đầu bước 2 (thu thập dữ liệu thị trường) |
| `templates/business-scenario-report.md` | Lúc tổng hợp báo cáo cuối (bước 5) |
| `checklists/completeness-checklist.md` | Cổng bắt buộc trước khi bàn giao |
