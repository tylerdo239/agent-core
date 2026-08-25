# Hướng dẫn — Phân tích nội bộ

Phần này đánh giá năng lực và rủi ro TỰ THÂN của tổ chức thực hiện kịch bản —
khác 2 phần trước (thị trường bên ngoài, số liệu định lượng), đây là góc nhìn
"chúng ta có làm được không, và nếu làm thì rủi ro gì".

## 1. SWOT — có bằng chứng, không sáo rỗng

Mỗi mục SWOT phải cụ thể và có căn cứ, không phải tính từ chung chung. Kiểm
tra bằng câu hỏi: "nếu xoá tên công ty đi, câu này có còn đúng cho MỌI công ty
trong ngành không?" — nếu có, đây là câu sáo rỗng, viết lại.

| Sai (sáo rỗng) | Đúng (cụ thể, có bằng chứng) |
|---|---|
| "Đội ngũ mạnh" | "Founder có 5 năm kinh nghiệm vận hành sản phẩm B2B cùng ngành tại công ty X, đã từng đưa sản phẩm từ 0 lên 10.000 user" |
| "Thị trường tiềm năng lớn" | Trích số TAM/SAM đã tính ở phần Phân tích kinh doanh, không lặp lại 1 câu định tính riêng ở đây |
| "Rủi ro cạnh tranh" | "Đối thủ X đã huy động 5 triệu USD vòng Series A tháng 3/2026 (nguồn: web_search), có thể tăng tốc mở rộng thị trường trước chúng ta 6-12 tháng" |

- **Strengths/Weaknesses** — nội tại, kiểm soát được (năng lực đội ngũ, sản
  phẩm, tài chính, quan hệ đối tác).
- **Opportunities/Threats** — bên ngoài, không kiểm soát được — nên tham chiếu
  trực tiếp số liệu đã có ở phần Phân tích kinh doanh (đừng phân tích thị
  trường 2 lần ở 2 chỗ khác nhau).

## 2. VRIO — đánh giá lợi thế cạnh tranh có bền vững không

Với mỗi năng lực/tài sản quan trọng nhất công ty có (công nghệ độc quyền, dữ
liệu, mối quan hệ, thương hiệu...), trả lời 4 câu hỏi:

1. **Value (Giá trị)** — năng lực này có giúp khai thác cơ hội hoặc né rủi ro
   thị trường không?
2. **Rarity (Hiếm)** — bao nhiêu đối thủ khác cũng có năng lực tương tự?
3. **Imitability (Khó bắt chước)** — đối thủ sao chép được năng lực này trong
   bao lâu, với chi phí bao nhiêu?
4. **Organization (Tổ chức khai thác được)** — công ty đã có quy trình/cấu
   trúc để thực sự khai thác năng lực này chưa, hay chỉ đang "có" mà chưa dùng
   được?

Năng lực nào trả lời "có" cho cả 4 câu là lợi thế cạnh tranh bền vững thật sự
— nêu rõ trong khuyến nghị đây là điểm nên tập trung đầu tư thêm.

## 3. Risk register

Bảng rủi ro — không liệt kê rủi ro chung chung ("rủi ro thị trường"), mỗi dòng
phải cụ thể và có biện pháp:

| Rủi ro | Xác suất (thấp/vừa/cao) | Tác động (thấp/vừa/cao) | Biện pháp giảm thiểu |
|---|---|---|---|
| (vd.) Đối thủ X ra mắt tính năng tương tự trước khi sản phẩm launch | Vừa | Cao | Rút ngắn MVP xuống 2 tính năng lõi, launch sớm hơn 6 tuần |

Ưu tiên xử lý rủi ro Xác suất×Tác động cao nhất trước — nêu rõ trong phần
khuyến nghị của báo cáo cuối, không chỉ liệt kê bảng rồi bỏ đó.

## 4. Readiness checklist — sẵn sàng triển khai chưa

- [ ] **Nhân sự**: đủ người cho 90 ngày đầu triển khai (không chỉ đủ người cho
      giai đoạn hiện tại)?
- [ ] **Tài chính**: runway đủ dài để đạt mốc thành công 90 ngày đã nêu ở
      `business-analysis-guide.md` mục Go-to-market (liên kết trực tiếp với
      KPI runway ở `kpi-framework.md`)?
- [ ] **Vận hành**: quy trình/công cụ cần thiết đã có, hay cần xây mới trước
      khi launch được?
- [ ] **Pháp lý/quy định**: ngành này có yêu cầu giấy phép/tuân thủ đặc biệt
      chưa được nhắc tới ở phần rào cản gia nhập (`business-analysis-guide.md`
      mục Cạnh tranh) không?

Mục nào chưa sẵn sàng → đưa thẳng vào risk register ở mục 3, không để rời rạc
không liên kết với phần rủi ro.
