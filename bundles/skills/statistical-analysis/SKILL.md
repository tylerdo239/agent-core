---
name: statistical-analysis
description: Áp dụng các phương pháp thống kê, gồm thống kê mô tả, phân tích xu hướng, phát hiện ngoại lệ và kiểm định giả thuyết. Sử dụng khi phân tích phân phối, kiểm định ý nghĩa thống kê, phát hiện bất thường, tính tương quan hoặc diễn giải kết quả thống kê.
user-invocable: false
---

# Skill phân tích thống kê

Hướng dẫn về thống kê mô tả, phân tích xu hướng, phát hiện ngoại lệ, kiểm định giả thuyết và những trường hợp cần thận trọng với các kết luận thống kê.

## Phương pháp thống kê mô tả

### Xu hướng trung tâm

Chọn thước đo trung tâm phù hợp với dữ liệu:

| Tình huống | Sử dụng | Lý do |
|---|---|---|
| Phân phối đối xứng, không có ngoại lệ | Trung bình | Ước lượng hiệu quả nhất |
| Phân phối lệch | Trung vị | Ít bị ảnh hưởng bởi ngoại lệ |
| Dữ liệu phân loại hoặc thứ bậc | Mode | Lựa chọn phù hợp cho dữ liệu phi số |
| Lệch mạnh và có ngoại lệ (ví dụ: doanh thu mỗi người dùng) | Trung vị + trung bình | Báo cáo cả hai; chênh lệch thể hiện độ lệch |

**Luôn báo cáo trung bình và trung vị cùng nhau đối với các chỉ số kinh doanh.** Nếu chúng chênh lệch đáng kể, dữ liệu bị lệch và chỉ dùng trung bình sẽ gây hiểu nhầm.

### Độ phân tán và biến thiên

- **Độ lệch chuẩn**: Mức độ các giá trị thường cách trung bình. Dùng với dữ liệu phân phối chuẩn.
- **Khoảng tứ phân vị (IQR)**: Khoảng cách từ p25 đến p75. Ít bị ảnh hưởng bởi ngoại lệ; dùng với dữ liệu lệch.
- **Hệ số biến thiên (CV)**: Độ lệch chuẩn / Trung bình. Dùng để so sánh biến thiên giữa các chỉ số có thang đo khác nhau.
- **Khoảng biến thiên**: Giá trị lớn nhất trừ nhỏ nhất. Nhạy với ngoại lệ nhưng cho biết nhanh phạm vi dữ liệu.

### Phân vị trong ngữ cảnh kinh doanh

Báo cáo các phân vị chính để truyền tải nhiều thông tin hơn chỉ riêng trung bình:

```
p1:   1% thấp nhất (sàn / giá trị điển hình nhỏ nhất)
p5:   Cận dưới của phạm vi bình thường
p25:  Tứ phân vị thứ nhất
p50:  Trung vị (người dùng điển hình)
p75:  Tứ phân vị thứ ba
p90:  10% cao nhất / người dùng tích cực
p95:  Cận trên của phạm vi bình thường
p99:  1% cao nhất / người dùng cực trị
```

**Ví dụ diễn giải**: "Thời lượng phiên trung vị là 4,2 phút, nhưng 10% người dùng cao nhất dành hơn 22 phút mỗi phiên, kéo giá trị trung bình lên 7,8 phút."

### Mô tả phân phối

Đặc trưng hóa mọi phân phối số được phân tích:

- **Hình dạng**: Chuẩn, lệch phải, lệch trái, hai đỉnh, đều, đuôi dày
- **Trung tâm**: Trung bình và trung vị (cùng chênh lệch giữa chúng)
- **Độ phân tán**: Độ lệch chuẩn hoặc IQR
- **Ngoại lệ**: Số lượng và mức độ cực đoan
- **Giới hạn**: Có sàn tự nhiên (0) hoặc trần (100%) không?

## Phân tích xu hướng và dự báo

### Xác định xu hướng

**Trung bình trượt** để làm mượt nhiễu:
```python
# Trung bình trượt 7 ngày (phù hợp với dữ liệu ngày có mùa vụ theo tuần)
df['ma_7d'] = df['metric'].rolling(window=7, min_periods=1).mean()

# Trung bình trượt 28 ngày (làm mượt cả mẫu hình tuần VÀ tháng)
df['ma_28d'] = df['metric'].rolling(window=28, min_periods=1).mean()
```

**So sánh theo kỳ**:
- Theo tuần (WoW): So với cùng ngày tuần trước
- Theo tháng (MoM): So với cùng tháng trước
- Theo năm (YoY): Tiêu chuẩn tốt nhất cho doanh nghiệp có tính mùa vụ
- Cùng ngày năm trước: So sánh một ngày cụ thể trên lịch

**Tốc độ tăng trưởng**:
```
Tăng trưởng đơn giản: (hiện tại - trước đó) / trước đó
CAGR: (cuối kỳ / đầu kỳ) ^ (1 / số năm) - 1
Tăng trưởng log: ln(hiện tại / trước đó) -- phù hợp hơn với chuỗi biến động mạnh
```

### Phát hiện tính mùa vụ

Kiểm tra các mẫu hình tuần hoàn:
1. Vẽ chuỗi thời gian thô; ưu tiên quan sát trực quan trước
2. Tính trung bình theo ngày trong tuần: có mẫu hình tuần rõ ràng không?
3. Tính trung bình theo tháng trong năm: có chu kỳ năm không?
4. Khi so sánh các kỳ, luôn dùng YoY hoặc cùng kỳ để tránh nhầm lẫn xu hướng với mùa vụ

### Dự báo bằng phương pháp đơn giản

Đối với nhà phân tích kinh doanh (không phải nhà khoa học dữ liệu), dùng các phương pháp dễ hiểu:

- **Dự báo ngây thơ**: Ngày mai = hôm nay. Dùng làm đường cơ sở.
- **Dự báo ngây thơ theo mùa vụ**: Ngày mai = cùng ngày tuần trước/năm trước.
- **Xu hướng tuyến tính**: Khớp một đường thẳng với dữ liệu lịch sử. Chỉ dùng khi xu hướng rõ ràng là tuyến tính.
- **Dự báo bằng trung bình trượt**: Dùng trung bình của khoảng thời gian gần nhất làm dự báo.

**Luôn truyền đạt mức độ bất định.** Cung cấp một khoảng, không chỉ một ước lượng điểm:
- "Dựa trên xu hướng 3 tháng, chúng tôi dự kiến có 10K-12K lượt đăng ký trong tháng tới"
- KHÔNG nói "Tháng tới chắc chắn sẽ có đúng 11.234 lượt đăng ký"

**Khi nào cần chuyển cho nhà khoa học dữ liệu**: Xu hướng phi tuyến, nhiều chu kỳ mùa vụ, yếu tố bên ngoài (chi tiêu marketing, ngày lễ), hoặc khi độ chính xác dự báo ảnh hưởng đến phân bổ nguồn lực.

## Phát hiện ngoại lệ và bất thường

### Phương pháp thống kê

**Phương pháp Z-score** (cho dữ liệu phân phối chuẩn):
```python
z_scores = (df['value'] - df['value'].mean()) / df['value'].std()
outliers = df[abs(z_scores) > 3]  # Lớn hơn 3 độ lệch chuẩn
```

**Phương pháp IQR** (bền vững với phân phối không chuẩn):
```python
Q1 = df['value'].quantile(0.25)
Q3 = df['value'].quantile(0.75)
IQR = Q3 - Q1
lower_bound = Q1 - 1.5 * IQR
upper_bound = Q3 + 1.5 * IQR
outliers = df[(df['value'] < lower_bound) | (df['value'] > upper_bound)]
```

**Phương pháp phân vị** (đơn giản nhất):
```python
outliers = df[(df['value'] < df['value'].quantile(0.01)) |
              (df['value'] > df['value'].quantile(0.99))]
```

### Xử lý ngoại lệ

KHÔNG tự động loại bỏ ngoại lệ. Thay vào đó:

1. **Điều tra**: Đây là lỗi dữ liệu, giá trị cực trị thực hay một quần thể khác?
2. **Lỗi dữ liệu**: Sửa hoặc loại bỏ (ví dụ: tuổi âm, timestamp ở năm 1970)
3. **Cực trị thực**: Giữ lại nhưng cân nhắc dùng thống kê bền vững (trung vị thay cho trung bình)
4. **Quần thể khác**: Tách thành phân khúc để phân tích riêng (ví dụ: khách hàng doanh nghiệp so với SMB)

**Báo cáo việc đã làm**: "Chúng tôi loại 47 bản ghi (0,3%) có giá trị giao dịch trên 50K USD; đây là các đơn hàng doanh nghiệp số lượng lớn và được phân tích riêng."

### Phát hiện bất thường trong chuỗi thời gian

1. Tính giá trị kỳ vọng (trung bình trượt hoặc cùng kỳ năm trước)
2. Tính độ lệch so với kỳ vọng
3. Đánh dấu độ lệch vượt ngưỡng (thường là 2-3 độ lệch chuẩn của phần dư)
4. Phân biệt bất thường điểm (một giá trị bất thường) với điểm thay đổi (dịch chuyển kéo dài)

## Kiến thức cơ bản về kiểm định giả thuyết

### Khi nào nên dùng

Dùng kiểm định giả thuyết để xác định liệu khác biệt quan sát được có khả năng là thật hay chỉ do ngẫu nhiên. Các tình huống phổ biến:

- Kết quả kiểm thử A/B: Biến thể B có thực sự tốt hơn A không?
- So sánh trước/sau: Thay đổi sản phẩm có thực sự làm dịch chuyển chỉ số không?
- So sánh phân khúc: Khách hàng doanh nghiệp có thực sự duy trì cao hơn không?

### Khung kiểm định

1. **Giả thuyết không (H0)**: Không có khác biệt (giả định mặc định)
2. **Giả thuyết đối (H1)**: Có khác biệt
3. **Chọn mức ý nghĩa (alpha)**: Thường là 0,05 (5% khả năng dương tính giả)
4. **Tính thống kê kiểm định và p-value**
5. **Diễn giải**: Nếu p < alpha, bác bỏ H0 (có bằng chứng về khác biệt thực)

### Các phép kiểm định phổ biến

| Tình huống | Kiểm định | Khi sử dụng |
|---|---|---|
| So sánh trung bình của hai nhóm | t-test độc lập | Dữ liệu chuẩn, hai nhóm |
| So sánh tỷ lệ của hai nhóm | z-test cho tỷ lệ | Tỷ lệ chuyển đổi, kết quả nhị phân |
| So sánh các phép đo theo cặp | Paired t-test | Trước/sau trên cùng đối tượng |
| So sánh trung bình của từ 3 nhóm | ANOVA | Nhiều phân khúc hoặc biến thể |
| Dữ liệu không chuẩn, hai nhóm | Mann-Whitney U | Chỉ số lệch, dữ liệu thứ bậc |
| Liên hệ giữa các danh mục | Chi-squared | Hai biến phân loại |

### Ý nghĩa thực tiễn và ý nghĩa thống kê

**Ý nghĩa thống kê** nghĩa là khác biệt khó có khả năng do ngẫu nhiên.

**Ý nghĩa thực tiễn** nghĩa là khác biệt đủ lớn để ảnh hưởng đến quyết định kinh doanh.

Một khác biệt có thể có ý nghĩa thống kê nhưng không đáng kể trong thực tiễn (thường gặp với mẫu lớn). Luôn báo cáo:
- **Kích thước hiệu ứng**: Khác biệt lớn đến đâu? (ví dụ: "Biến thể B cải thiện tỷ lệ chuyển đổi 0,3 điểm phần trăm")
- **Khoảng tin cậy**: Phạm vi hợp lý của hiệu ứng thực là gì?
- **Tác động kinh doanh**: Điều này tương ứng với bao nhiêu doanh thu, người dùng hoặc chỉ số kinh doanh khác?

### Cân nhắc về cỡ mẫu

- Mẫu nhỏ tạo ra kết quả kém tin cậy, ngay cả khi p-value có ý nghĩa
- Quy tắc kinh nghiệm cho tỷ lệ: Cần ít nhất 30 sự kiện mỗi nhóm để có độ tin cậy cơ bản
- Để phát hiện hiệu ứng nhỏ (ví dụ: thay đổi 1% tỷ lệ chuyển đổi), có thể cần hàng nghìn quan sát mỗi nhóm
- Nếu mẫu nhỏ, hãy nói rõ: "Với chỉ 200 quan sát mỗi nhóm, khả năng phát hiện hiệu ứng nhỏ hơn X% còn hạn chế"

## Khi cần thận trọng với kết luận thống kê

### Tương quan không đồng nghĩa với quan hệ nhân quả

Khi tìm thấy tương quan, hãy xem xét rõ ràng:
- **Nhân quả ngược**: Có thể B gây ra A, không phải A gây ra B
- **Biến gây nhiễu**: Có thể C gây ra cả A và B
- **Trùng hợp**: Khi có đủ nhiều biến, tương quan giả là điều không thể tránh khỏi

**Có thể nói**: "Người dùng sử dụng tính năng X có tỷ lệ duy trì cao hơn 30%"
**Không thể nói nếu thiếu thêm bằng chứng**: "Tính năng X làm tỷ lệ duy trì tăng 30%"

### Vấn đề so sánh nhiều lần

Khi kiểm định nhiều giả thuyết, một số kết quả sẽ "có ý nghĩa" chỉ do ngẫu nhiên:
- Kiểm định 20 chỉ số với p=0,05 đồng nghĩa khoảng 1 kết quả sẽ là dương tính giả
- Nếu đã xem nhiều phân khúc trước khi tìm thấy một phân khúc khác biệt, hãy ghi rõ
- Điều chỉnh cho nhiều phép so sánh bằng hiệu chỉnh Bonferroni (chia alpha cho số phép kiểm định) hoặc báo cáo số phép kiểm định đã chạy

### Nghịch lý Simpson

Một xu hướng trong dữ liệu tổng hợp có thể đảo ngược khi phân khúc dữ liệu:
- Luôn kiểm tra kết luận có đúng trong các phân khúc chính hay không
- Ví dụ: Tỷ lệ chuyển đổi tổng thể tăng nhưng giảm trong mọi phân khúc, vì cơ cấu chuyển sang phân khúc có tỷ lệ chuyển đổi cao hơn

### Thiên lệch sống sót

Chỉ có thể phân tích các đối tượng đã "sống sót" để xuất hiện trong tập dữ liệu:
- Phân tích người dùng đang hoạt động bỏ qua những người đã rời bỏ
- Phân tích công ty thành công bỏ qua những công ty thất bại
- Luôn hỏi: "Ai đang vắng mặt trong tập dữ liệu này, và việc bổ sung họ có thay đổi kết luận không?"

### Ngụy biện sinh thái

Xu hướng tổng hợp có thể không đúng với từng cá nhân:
- "Quốc gia có X cao hơn thì Y cao hơn" KHÔNG có nghĩa "cá nhân có X cao hơn thì Y cao hơn"
- Thận trọng khi áp dụng phát hiện cấp nhóm cho từng trường hợp cá nhân

### Neo vào các con số cụ thể

Cẩn trọng với độ chính xác giả:
- "Tỷ lệ rời bỏ quý tới sẽ là 4,73%" thể hiện mức chắc chắn cao hơn bằng chứng cho phép
- Ưu tiên khoảng: "Dựa trên mẫu hình lịch sử, chúng tôi dự kiến tỷ lệ rời bỏ nằm trong khoảng 4-6%"
- Làm tròn phù hợp: "Khoảng 5%" thường trung thực hơn "4,73%"
