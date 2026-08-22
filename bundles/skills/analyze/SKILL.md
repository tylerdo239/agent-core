---
name: analyze
description: Trả lời các câu hỏi về dữ liệu, từ tra cứu nhanh đến phân tích đầy đủ. Sử dụng khi cần tra cứu một chỉ số, tìm nguyên nhân của một xu hướng hoặc sự sụt giảm, so sánh các phân khúc theo thời gian, hoặc chuẩn bị báo cáo dữ liệu chính thức cho các bên liên quan.
argument-hint: "<câu hỏi>"
---

# /analyze - Trả lời câu hỏi về dữ liệu

> Nếu gặp placeholder lạ hoặc cần kiểm tra những công cụ nào đang được kết nối, hãy xem [CONNECTORS.md](../../CONNECTORS.md).

Trả lời một câu hỏi về dữ liệu, từ tra cứu nhanh đến phân tích đầy đủ hoặc báo cáo chính thức.

## Cách sử dụng

```
/analyze <câu hỏi bằng ngôn ngữ tự nhiên>
```

## Quy trình

### 1. Hiểu câu hỏi

Phân tích câu hỏi của người dùng và xác định:

- **Mức độ phức tạp**:
  - **Trả lời nhanh**: Một chỉ số, bộ lọc đơn giản, tra cứu dữ kiện (ví dụ: "Có bao nhiêu người dùng đăng ký trong tuần trước?")
  - **Phân tích đầy đủ**: Khám phá đa chiều, phân tích xu hướng, so sánh (ví dụ: "Điều gì đang khiến tỷ lệ chuyển đổi giảm?")
  - **Báo cáo chính thức**: Điều tra toàn diện kèm phương pháp, lưu ý và đề xuất (ví dụ: "Chuẩn bị báo cáo kinh doanh quý về các chỉ số thuê bao")
- **Yêu cầu dữ liệu**: Cần những bảng, chỉ số, chiều dữ liệu và khoảng thời gian nào
- **Định dạng đầu ra**: Số, bảng, biểu đồ, diễn giải, hoặc kết hợp

### 2. Thu thập dữ liệu

**Nếu đã kết nối máy chủ MCP của kho dữ liệu:**

1. Khám phá schema để tìm các bảng và cột liên quan
2. Viết một hoặc nhiều truy vấn SQL để trích xuất dữ liệu cần thiết
3. Thực thi truy vấn và lấy kết quả
4. Nếu truy vấn thất bại, gỡ lỗi rồi thử lại (kiểm tra tên cột, tham chiếu bảng và cú pháp của dialect cụ thể)
5. Nếu kết quả có vẻ bất thường, thực hiện các phép kiểm tra hợp lý trước khi tiếp tục

**Nếu chưa kết nối kho dữ liệu:**

1. Yêu cầu người dùng cung cấp dữ liệu theo một trong các cách sau:
   - Dán trực tiếp kết quả truy vấn
   - Tải lên tệp CSV hoặc Excel
   - Mô tả schema để có thể viết truy vấn cho họ chạy
2. Nếu viết truy vấn để người dùng tự thực thi, sử dụng skill `sql-queries` để áp dụng các thực hành tốt nhất theo từng dialect
3. Khi đã có dữ liệu, tiến hành phân tích

### 3. Phân tích

- Tính toán các chỉ số, phép tổng hợp và so sánh liên quan
- Xác định mẫu hình, xu hướng, ngoại lệ và bất thường
- So sánh giữa các chiều dữ liệu (giai đoạn, phân khúc, danh mục)
- Với phân tích phức tạp, chia vấn đề thành các câu hỏi nhỏ rồi lần lượt giải quyết

### 4. Xác thực trước khi trình bày

Trước khi chia sẻ kết quả, thực hiện các bước kiểm tra sau:

- **Kiểm tra số hàng**: Số lượng bản ghi có hợp lý không?
- **Kiểm tra null**: Có giá trị null bất thường nào có thể làm sai lệch kết quả không?
- **Kiểm tra độ lớn**: Các con số có nằm trong phạm vi hợp lý không?
- **Tính liên tục của xu hướng**: Chuỗi thời gian có khoảng trống bất thường không?
- **Logic tổng hợp**: Tổng các phần có khớp với tổng chung không?

Nếu bất kỳ kiểm tra nào cho thấy vấn đề, hãy điều tra và ghi rõ các lưu ý.

### 5. Trình bày phát hiện

**Đối với câu trả lời nhanh:**
- Nêu câu trả lời trực tiếp kèm ngữ cảnh liên quan
- Đưa truy vấn đã dùng vào phần thu gọn hoặc khối mã để có thể tái lập

**Đối với phân tích đầy đủ:**
- Mở đầu bằng phát hiện hoặc insight chính
- Cung cấp bảng dữ liệu và/hoặc biểu đồ hỗ trợ
- Nêu phương pháp và mọi lưu ý
- Đề xuất các câu hỏi tiếp theo

**Đối với báo cáo chính thức:**
- Tóm tắt điều hành với các kết luận chính
- Phần phương pháp giải thích cách tiếp cận và nguồn dữ liệu
- Các phát hiện chi tiết kèm bằng chứng
- Lưu ý, hạn chế và ghi chú về chất lượng dữ liệu
- Đề xuất và các bước tiếp theo

### 6. Trực quan hóa khi hữu ích

Khi biểu đồ truyền đạt kết quả hiệu quả hơn bảng:

- Sử dụng skill `data-visualization` để chọn loại biểu đồ phù hợp
- Tạo biểu đồ bằng Python hoặc tích hợp vào dashboard HTML
- Tuân thủ các thực hành trực quan hóa tốt nhất về độ rõ ràng và chính xác

## Ví dụ

**Trả lời nhanh:**
```
/analyze Có bao nhiêu người dùng mới đăng ký trong tháng 12?
```

**Phân tích đầy đủ:**
```
/analyze Điều gì gây ra sự gia tăng lượng phiếu hỗ trợ trong 3 tháng qua? Hãy phân tích theo danh mục và mức độ ưu tiên.
```

**Báo cáo chính thức:**
```
/analyze Chuẩn bị đánh giá chất lượng dữ liệu của bảng khách hàng, bao gồm tính đầy đủ, nhất quán và các vấn đề cần xử lý.
```

## Mẹo

- Khi có thể, hãy nêu rõ khoảng thời gian, phân khúc hoặc chỉ số
- Nếu biết tên bảng, hãy đề cập để đẩy nhanh quá trình
- Với câu hỏi phức tạp, tác nhân có thể chia thành nhiều truy vấn
- Kết quả luôn được xác thực trước khi trình bày; nếu có điểm bất thường, tác nhân sẽ cảnh báo
