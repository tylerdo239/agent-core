---
name: validate-data
description: Kiểm tra QA một phân tích trước khi chia sẻ, bao gồm phương pháp, độ chính xác và thiên lệch. Sử dụng khi rà soát phân tích trước buổi trình bày, kiểm tra nhanh phép tính và logic tổng hợp, xác minh kết quả truy vấn SQL hoặc đánh giá liệu kết luận có thực sự được dữ liệu hỗ trợ.
argument-hint: "<phân tích cần rà soát>"
---

# /validate-data - Xác thực phân tích trước khi chia sẻ

> Nếu gặp placeholder lạ hoặc cần kiểm tra những công cụ nào đang được kết nối, hãy xem [CONNECTORS.md](../../CONNECTORS.md).

Rà soát độ chính xác, phương pháp và thiên lệch tiềm ẩn của một phân tích trước khi chia sẻ với các bên liên quan. Tạo đánh giá độ tin cậy và đề xuất cải thiện.

## Cách sử dụng

```
/validate-data <phân tích cần rà soát>
```

Phân tích có thể là tài liệu hoặc báo cáo trong cuộc trò chuyện, tệp Markdown/notebook/bảng tính, truy vấn SQL và kết quả, biểu đồ cùng dữ liệu nguồn, hoặc mô tả phương pháp và phát hiện.

## Quy trình

### 1. Rà soát phương pháp và giả định

Kiểm tra:

- **Cách đặt câu hỏi**: Phân tích có trả lời đúng câu hỏi không? Có cách diễn giải khác không?
- **Lựa chọn dữ liệu**: Đã dùng đúng bảng/tập dữ liệu và khoảng thời gian chưa?
- **Định nghĩa quần thể**: Quần thể có được định nghĩa đúng không? Có loại trừ ngoài ý muốn không?
- **Định nghĩa chỉ số**: Chỉ số có rõ ràng, nhất quán và đúng với cách các bên liên quan hiểu không?
- **Đường cơ sở và so sánh**: Các kỳ, cỡ cohort và bối cảnh có thực sự so sánh được không?

### 2. Chạy checklist QA trước khi bàn giao

Thực hiện checklist bên dưới về chất lượng dữ liệu, phép tính, tính hợp lý và cách trình bày.

### 3. Kiểm tra các sai lầm phân tích phổ biến

Rà soát có hệ thống các vấn đề: join làm phình dữ liệu, thiên lệch sống sót, so sánh kỳ chưa hoàn tất, mẫu số thay đổi, trung bình của các giá trị trung bình, lệch múi giờ và thiên lệch chọn mẫu.

### 4. Xác minh phép tính và tổng hợp

Khi có thể:

- Tính lại độc lập một vài con số chính
- Xác minh tổng các phần khớp tổng chung
- Kiểm tra tỷ lệ cộng thành 100% hoặc gần 100% khi được kỳ vọng
- Xác nhận so sánh YoY/MoM dùng đúng kỳ cơ sở
- Xác nhận bộ lọc được áp dụng nhất quán cho mọi chỉ số
- Áp dụng kiểm tra độ lớn, đối chiếu chéo và phát hiện dấu hiệu cảnh báo

### 5. Đánh giá trực quan hóa

- Trục có bắt đầu ở giá trị phù hợp, đặc biệt là 0 với biểu đồ cột, không?
- Thang đo có nhất quán giữa các biểu đồ so sánh không?
- Tiêu đề có mô tả chính xác nội dung không?
- Trực quan có thể gây hiểu nhầm cho người đọc nhanh không?
- Có trục bị cắt, khoảng chia không nhất quán hoặc hiệu ứng 3D làm sai lệch cảm nhận không?

### 6. Đánh giá diễn giải và kết luận

Kiểm tra liệu kết luận có được dữ liệu hỗ trợ, cách giải thích thay thế có được thừa nhận, độ bất định có được truyền đạt phù hợp, đề xuất có theo logic từ phát hiện và mức tự tin có tương xứng với bằng chứng hay không.

### 7. Đề xuất cải thiện

Đưa ra đề xuất cụ thể, có thể hành động: phân tích bổ sung, lưu ý hoặc hạn chế cần nêu, trực quan hoặc cách diễn đạt tốt hơn, và ngữ cảnh mà các bên liên quan còn thiếu.

### 8. Tạo đánh giá độ tin cậy

Đánh giá theo ba mức:

**Sẵn sàng chia sẻ** -- Phương pháp hợp lý, phép tính đã xác minh, các lưu ý đã được nêu. Chỉ còn cải thiện nhỏ, không có vấn đề chặn.

**Chia sẻ kèm lưu ý** -- Phân tích nhìn chung đúng nhưng có hạn chế hoặc giả định cụ thể phải truyền đạt. Liệt kê các lưu ý bắt buộc.

**Cần chỉnh sửa** -- Có lỗi, vấn đề phương pháp hoặc phân tích còn thiếu cần xử lý trước khi chia sẻ. Liệt kê thay đổi theo thứ tự ưu tiên.

## Định dạng đầu ra

```
## Báo cáo xác thực

### Đánh giá tổng thể: [Sẵn sàng chia sẻ | Chia sẻ kèm lưu ý | Cần chỉnh sửa]

### Rà soát phương pháp
[Phát hiện về cách tiếp cận, lựa chọn dữ liệu và định nghĩa]

### Vấn đề phát hiện được
1. [Mức độ: Cao/Trung bình/Thấp] [Mô tả và tác động]

### Kiểm tra nhanh phép tính
- [Chỉ số]: [Đã xác minh / Phát hiện sai lệch]

### Rà soát trực quan hóa
[Vấn đề với biểu đồ hoặc cách trình bày]

### Cải thiện đề xuất
1. [Cải thiện và lý do quan trọng]

### Lưu ý bắt buộc dành cho các bên liên quan
- [Lưu ý phải được truyền đạt]
```

---

## Checklist QA trước khi bàn giao

### Chất lượng dữ liệu

- [ ] **Nguồn**: Xác nhận bảng/nguồn dữ liệu đã dùng và tính phù hợp với câu hỏi
- [ ] **Độ mới**: Dữ liệu đủ mới; ghi ngày "tính đến"
- [ ] **Tính đầy đủ**: Không có khoảng trống chuỗi thời gian hoặc phân khúc bị thiếu ngoài dự kiến
- [ ] **Xử lý null**: Kiểm tra tỷ lệ null ở cột chính; loại, bù hoặc đánh dấu phù hợp
- [ ] **Khử trùng**: Không đếm hai lần do join sai hoặc bản ghi nguồn trùng
- [ ] **Bộ lọc**: Mọi mệnh đề `WHERE` và bộ lọc đều đúng, không loại trừ ngoài ý muốn

### Phép tính

- [ ] **Logic tổng hợp**: `GROUP BY` gồm mọi cột không tổng hợp và đúng grain phân tích
- [ ] **Mẫu số**: Tỷ lệ dùng đúng mẫu số và mẫu số khác 0
- [ ] **Căn chỉnh ngày**: So sánh các kỳ cùng độ dài; kỳ chưa hoàn tất được loại hoặc ghi chú
- [ ] **Join**: Dùng đúng loại `INNER`/`LEFT`; join nhiều-nhiều không làm phình số đếm
- [ ] **Định nghĩa chỉ số**: Khớp với định nghĩa của các bên liên quan; mọi sai khác đều được nêu
- [ ] **Tổng phụ**: Các phần cộng thành tổng khi được kỳ vọng; nếu không, giải thích nguyên nhân như chồng lấn

### Tính hợp lý

- [ ] **Độ lớn**: Số nằm trong phạm vi hợp lý; doanh thu không âm; tỷ lệ từ 0-100%
- [ ] **Tính liên tục**: Không có bước nhảy hoặc giảm không giải thích được trong chuỗi thời gian
- [ ] **Đối chiếu**: Số chính khớp dashboard, báo cáo trước hoặc dữ liệu tài chính
- [ ] **Bậc độ lớn**: Tổng doanh thu và số người dùng gần với số liệu đã biết
- [ ] **Trường hợp biên**: Kiểm tra phân khúc rỗng, kỳ không hoạt động và thực thể mới

### Trình bày

- [ ] **Biểu đồ**: Cột bắt đầu từ 0, trục có nhãn, thang đo nhất quán
- [ ] **Định dạng số**: Độ chính xác, tiền tệ, phần trăm và dấu phân cách hàng nghìn nhất quán
- [ ] **Tiêu đề**: Nêu insight và khoảng ngày, không chỉ tên chỉ số
- [ ] **Lưu ý**: Hạn chế và giả định đã biết được nêu rõ
- [ ] **Khả năng tái lập**: Người khác có thể tái tạo phân tích từ tài liệu đã cung cấp

## Các sai lầm phân tích dữ liệu phổ biến

### Join làm phình dữ liệu

**Vấn đề**: Join nhiều-nhiều âm thầm nhân số hàng, làm phình số đếm và tổng.

```sql
-- Kiểm tra số hàng trước và sau join
SELECT COUNT(*) FROM table_a;  -- 1.000
SELECT COUNT(*) FROM table_a a JOIN table_b b ON a.id = b.a_id;  -- 3.500 (bất thường)
```

Luôn kiểm tra số hàng sau join. Nếu số hàng tăng, xác minh quan hệ thực sự là 1:1 hay 1:nhiều. Khi đếm thực thể qua join, cân nhắc `COUNT(DISTINCT a.id)` thay cho `COUNT(*)`.

### Thiên lệch sống sót

**Vấn đề**: Chỉ phân tích thực thể còn tồn tại, bỏ qua những thực thể đã bị xóa, rời bỏ hoặc thất bại. Trước khi kết luận, luôn hỏi: "Ai KHÔNG có mặt trong tập dữ liệu này?"

### So sánh kỳ chưa hoàn tất

**Vấn đề**: So sánh một phần của kỳ hiện tại với toàn bộ kỳ trước. Luôn lọc về các kỳ hoàn tất hoặc so sánh cùng ngày trong tháng/cùng số ngày.

### Mẫu số thay đổi

**Vấn đề**: Mẫu số thay đổi giữa các kỳ khiến tỷ lệ không còn so sánh được, ví dụ thay đổi định nghĩa người dùng "đủ điều kiện" hoặc "hoạt động". Dùng định nghĩa nhất quán và ghi rõ mọi thay đổi.

### Trung bình của các giá trị trung bình

**Vấn đề**: Lấy trung bình của các giá trị trung bình đã tính sẵn sẽ sai khi cỡ nhóm khác nhau.

- Nhóm A: 100 người dùng, doanh thu trung bình 50 USD
- Nhóm B: 10 người dùng, doanh thu trung bình 200 USD
- Sai: `(50 + 200) / 2 = 125 USD`
- Đúng: Trung bình gia quyền `(100*50 + 10*200) / 110 = 63,64 USD`

Luôn tổng hợp từ dữ liệu thô; không lấy trung bình của các giá trị đã tổng hợp.

### Lệch múi giờ

**Vấn đề**: Nguồn dữ liệu dùng múi giờ khác nhau gây lệch timestamp hoặc mốc chốt ngày. Chuẩn hóa về một múi giờ, khuyến nghị UTC, trước khi phân tích và ghi rõ múi giờ.

### Thiên lệch chọn mẫu trong phân khúc

**Vấn đề**: Phân khúc được định nghĩa bằng chính kết quả đang đo, tạo logic vòng tròn. Hãy định nghĩa phân khúc theo đặc điểm có trước can thiệp, không theo kết quả.

### Bẫy thống kê khác

- Nghịch lý Simpson: Xu hướng đảo chiều giữa dữ liệu tổng hợp và phân khúc
- Trình bày tương quan như quan hệ nhân quả khi thiếu bằng chứng
- Cỡ mẫu nhỏ dẫn đến kết luận kém tin cậy
- Ngoại lệ ảnh hưởng quá mức đến trung bình; cân nhắc dùng trung vị
- Kiểm định nhiều lần hoặc chọn lọc kết quả có ý nghĩa
- Thiên lệch nhìn trước: dùng thông tin tương lai để giải thích quá khứ
- Chọn khoảng thời gian có lợi cho một câu chuyện cụ thể

## Kiểm tra tính hợp lý của kết quả

### Kiểm tra độ lớn

| Loại chỉ số | Kiểm tra |
|---|---|
| Số người dùng | Có khớp MAU/DAU đã biết không? |
| Doanh thu | Có đúng bậc độ lớn so với ARR đã biết không? |
| Tỷ lệ chuyển đổi | Có trong 0-100% và khớp dashboard không? |
| Tốc độ tăng trưởng | Tăng trên 50% MoM có thực tế hay là lỗi dữ liệu? |
| Trung bình | Có hợp lý so với phân phối đã biết không? |
| Phần trăm | Tỷ lệ các phân khúc có cộng thành xấp xỉ 100% không? |

### Kỹ thuật đối chiếu chéo

1. Tính cùng một chỉ số theo hai cách và xác minh kết quả khớp nhau
2. Chọn vài bản ghi cụ thể và lần theo dữ liệu thủ công
3. So sánh với dashboard, báo cáo tài chính hoặc phân tích trước
4. Kiểm tra ngược: doanh thu mỗi người dùng nhân số người dùng có xấp xỉ tổng doanh thu không?
5. Kiểm tra biên bằng một ngày, một người dùng hoặc một danh mục

### Dấu hiệu cần điều tra

- Chỉ số thay đổi trên 50% theo kỳ mà không có nguyên nhân rõ ràng
- Số đếm hoặc tổng là số tròn tuyệt đối
- Tỷ lệ đúng 0% hoặc 100%
- Kết quả xác nhận giả thuyết một cách hoàn hảo
- Giá trị giống hệt giữa các kỳ hoặc phân khúc

## Tiêu chuẩn tài liệu để tái lập

### Mẫu tài liệu phân tích

Mọi phân tích không đơn giản phải bao gồm:

```markdown
## Phân tích: [Tiêu đề]

### Câu hỏi
[Câu hỏi cụ thể đang được trả lời]

### Nguồn dữ liệu
- Bảng: [schema.tên_bảng] (tính đến [ngày])
- Bảng: [schema.bảng_khác] (tính đến [ngày])
- Tệp: [tên_tệp] (nguồn: [nơi lấy tệp])

### Định nghĩa
- [Chỉ số A]: [Cách tính chính xác]
- [Phân khúc X]: [Cách xác định thành viên chính xác]
- [Khoảng thời gian]: [Ngày bắt đầu] đến [ngày kết thúc], [múi giờ]

### Phương pháp
1. [Bước 1 của cách tiếp cận]
2. [Bước 2]
3. [Bước 3]

### Giả định và hạn chế
- [Giả định 1 và lý do hợp lý]
- [Hạn chế 1 và tác động tiềm ẩn đến kết luận]

### Phát hiện chính
1. [Phát hiện 1 kèm bằng chứng]
2. [Phát hiện 2 kèm bằng chứng]

### Truy vấn SQL
[Mọi truy vấn đã dùng, kèm chú thích]

### Lưu ý
- [Điều người đọc cần biết trước khi hành động]
```

### Tài liệu cho mã nguồn

Với mã SQL/Python có thể tái sử dụng, ghi mục đích, tác giả, ngày, nguồn dữ liệu, lần xác thực gần nhất, giả định và cấu trúc đầu ra:

```python
"""
Phân tích: Tỷ lệ duy trì theo cohort tháng
Tác giả: [Tên]
Ngày: [Ngày]
Nguồn dữ liệu: bảng events, bảng users
Xác thực gần nhất: [Ngày] -- kết quả khớp dashboard trong phạm vi 2%

Mục đích:
    Tính các cohort duy trì người dùng theo tháng dựa trên ngày hoạt động đầu tiên.

Giả định:
    - "Hoạt động" nghĩa là có ít nhất một sự kiện trong tháng
    - Loại tài khoản kiểm thử/nội bộ (user_type != 'internal')
    - Luôn dùng ngày theo UTC

Đầu ra:
    Ma trận duy trì cohort với hàng cohort_month và cột months_since_signup.
    Giá trị là tỷ lệ duy trì (0-100%).
"""
```

### Quản lý phiên bản cho phân tích

- Lưu truy vấn và mã trong Git hoặc hệ thống tài liệu dùng chung
- Ghi ngày snapshot dữ liệu đã dùng
- Khi chạy lại với dữ liệu mới, ghi lại nội dung thay đổi và lý do
- Liên kết các phiên bản trước của phân tích định kỳ để so sánh xu hướng

## Ví dụ

```
/validate-data Rà soát phân tích doanh thu quý này trước khi tôi gửi cho ban điều hành: [phân tích]
```

```
/validate-data Kiểm tra phân tích churn của tôi; tôi đang so sánh Q4 với Q3 nhưng Q4 có cửa sổ đo ngắn hơn
```

```
/validate-data Đây là truy vấn SQL và kết quả cho funnel chuyển đổi. Logic có đúng không? [truy vấn + kết quả]
```

## Mẹo

- Chạy `/validate-data` trước mọi buổi trình bày hoặc quyết định có mức ảnh hưởng cao
- Ngay cả phân tích nhanh cũng nên được kiểm tra hợp lý
- Nếu phát hiện vấn đề, sửa rồi xác thực lại
- Chia sẻ kết quả xác thực cùng phân tích để tăng độ tin cậy cho các bên liên quan
