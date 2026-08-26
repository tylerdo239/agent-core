# Hướng dẫn — thu thập dữ liệu qua `web_search` cho kịch bản kinh doanh

Hướng dẫn chung của tool `web_search` (tự chèn vào system prompt) nói về cách
gọi tool đúng cú pháp. File này nói RIÊNG về kỷ luật thu thập dữ liệu thị
trường cho use-case kịch bản kinh doanh — đọc trước khi bắt đầu bước 2 trong
`SKILL.md`.

## 0. Ngôn ngữ query — xác định TRƯỚC lượt search đầu tiên

Xem SKILL.md rule #2: đối tượng Việt Nam (công ty, thị trường VN — kể cả tên
có chữ tiếng Anh như "FPT Telecom") → lượt search ĐẦU TIÊN bắt buộc bằng
tiếng Việt (vd. `"FPT Telecom kết quả kinh doanh 2025"`, `"quy mô thị trường
viễn thông Việt Nam 2025"`), không phải bản dịch tiếng Anh của cùng câu hỏi.
Chỉ chuyển sang tiếng Anh cho lượt search TIẾP THEO nếu nguồn tiếng Việt
nghèo nàn (thường xảy ra với báo cáo ngành công nghệ/benchmark quốc tế, mục
4 dưới đây) — và khi đó phải ghi rõ trong báo cáo đây là nguồn tham chiếu
quốc tế, không phải số liệu gốc của đối tượng VN đang phân tích.

## 1. Loại query nên chạy

Chạy có mục đích, không search tràn lan. Với 1 kịch bản đầy đủ, thường cần
khoảng 4-8 lượt search, chia theo mục đích:

1. **Quy mô thị trường** — đối tượng VN: `"quy mô thị trường <ngành> Việt Nam
   2025"` bằng tiếng Việt trước; chỉ chuyển sang `"<ngành> market size Vietnam
   2025"` (tiếng Anh) nếu nguồn tiếng Việt nghèo nàn (báo cáo ngành thường
   công bố bằng tiếng Anh nhiều hơn) — xem mục 0.
2. **Xu hướng ngành** — tin tức/báo cáo 6-12 tháng gần nhất, tránh trích dẫn
   nguồn quá cũ (số liệu ngành thay đổi nhanh, đặc biệt ngành công nghệ).
3. **Đối thủ cụ thể** — tên công ty + "pricing"/"funding"/"tính năng" — cần
   tên cụ thể tìm ra được ở bước market sizing, không tìm chung chung.
4. **Benchmark ngành cho KPI** — vd. "SaaS LTV:CAC ratio benchmark", để có cơ
   sở so sánh khi đặt mục tiêu KPI ở `kpi-framework.md`.

## 2. Số lượng search hợp lý

Không cần search cho mọi câu trong báo cáo. Ưu tiên search cho: (a) số liệu sẽ
xuất hiện trong bảng KPI hoặc phần market sizing (có ảnh hưởng trực tiếp đến
kết luận), (b) tên/số liệu đối thủ cụ thể. KHÔNG cần search cho các khung lý
thuyết đã có sẵn trong `references/` (TAM/SAM/SOM, VRIO, SWOT — đây là
phương pháp luận, không phải số liệu cần tra cứu).

## 3. Xử lý số liệu mâu thuẫn giữa các nguồn

Khi 2 nguồn cho ra 2 con số khác nhau đáng kể cho cùng 1 chỉ số (vd. quy mô
thị trường), KHÔNG tự chọn 1 số rồi bỏ qua số kia. Xử lý theo thứ tự ưu tiên:

1. Nêu **cả khoảng** (vd. "theo 2 nguồn khác nhau, ước tính 50-120 triệu USD")
   thay vì chọn 1 điểm giữa tuỳ tiện.
2. Nếu 1 nguồn rõ ràng đáng tin hơn (báo cáo ngành có phương pháp luận công
   bố, số liệu chính phủ) so với nguồn còn lại (bài blog không rõ nguồn gốc),
   ưu tiên nguồn đáng tin hơn nhưng vẫn nhắc tới nguồn kia và lý do không dùng.
3. Không tìm được lý do để ưu tiên nguồn nào → giữ nguyên cả khoảng, đưa vào
   phần best/base/worst case ở `scientific-analysis-guide.md` (cận dưới của
   khoảng làm worst case cho quy mô thị trường, cận trên làm best case).

## 4. Trích dẫn trong báo cáo cuối

Mọi con số quan trọng trong bảng KPI hoặc phần market sizing phải đi kèm:
**nguồn** (tên trang/tổ chức) và **thời điểm** (ngày bài viết, hoặc ngày tìm
kiếm nếu bài viết không ghi ngày). Toàn bộ URL đã dùng tập hợp vào mục "Nguồn
tham khảo" cuối báo cáo (xem `templates/business-scenario-report.md`) — không
rải rác trích dẫn không nhất quán trong từng đoạn.

## 5. Giới hạn cần nói rõ trong báo cáo

`web_search` hiện tra cứu qua HTML công khai (không phải nguồn dữ liệu thị
trường chuyên dụng trả phí như Statista/CB Insights/Gartner). Số liệu thu được
có thể nông hơn, cũ hơn, hoặc thiếu chi tiết so với báo cáo ngành chuyên sâu.
Ghi rõ giới hạn này trong phần "Nguồn tham khảo" của báo cáo cuối — không giả
vờ số liệu tìm được có độ tin cậy tương đương 1 báo cáo ngành trả phí.
