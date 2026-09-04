---
name: explore-data
description: Lập hồ sơ và khám phá tập dữ liệu để hiểu cấu trúc, chất lượng và các mẫu hình. Sử dụng khi gặp bảng hoặc tệp mới, kiểm tra tỷ lệ null và phân phối cột, phát hiện vấn đề chất lượng như bản ghi trùng hoặc giá trị đáng ngờ, hoặc quyết định các chiều và chỉ số cần phân tích.
argument-hint: "<bảng hoặc tệp>"
---

# /explore-data - Lập hồ sơ và khám phá tập dữ liệu

> Nếu gặp placeholder lạ hoặc cần kiểm tra những công cụ nào đang được kết nối, hãy xem [CONNECTORS.md](../../CONNECTORS.md).

Tạo hồ sơ dữ liệu toàn diện cho một bảng hoặc tệp đã tải lên. Hiểu cấu trúc, chất lượng và mẫu hình trước khi đi sâu vào phân tích.

## Cách sử dụng

```
/explore-data <tên_bảng hoặc tệp>
```

## Quy trình

### 1. Truy cập dữ liệu

**Nếu đã kết nối máy chủ MCP của kho dữ liệu:**

1. Phân giải tên bảng; xử lý tiền tố schema và đề xuất kết quả khớp nếu tên mơ hồ
2. Truy vấn metadata của bảng: tên cột, kiểu dữ liệu và mô tả nếu có
3. Chạy các truy vấn lập hồ sơ trên dữ liệu thực

**Nếu có tệp CSV, Excel, Parquet hoặc JSON:**

1. Đọc tệp và tải vào tập dữ liệu làm việc
2. Suy luận kiểu cột từ dữ liệu

**Nếu không có cả hai:**

1. Yêu cầu người dùng cung cấp tên bảng khi kho dữ liệu đã kết nối hoặc tải lên một tệp
2. Nếu họ mô tả schema, hướng dẫn các truy vấn lập hồ sơ cần chạy

### 2. Hiểu cấu trúc

Trước khi phân tích dữ liệu, hãy trả lời:

**Ở cấp bảng:**
- Có bao nhiêu hàng và cột?
- Grain là gì, tức mỗi hàng đại diện cho đối tượng nào?
- Khóa chính là gì và có duy nhất không?
- Dữ liệu được cập nhật lần cuối khi nào?
- Dữ liệu kéo dài từ thời điểm nào?

**Phân loại cột** thành một trong các nhóm:
- **Định danh**: Khóa duy nhất, khóa ngoại, ID thực thể
- **Chiều dữ liệu**: Thuộc tính phân loại để nhóm/lọc (trạng thái, loại, khu vực, danh mục)
- **Chỉ số**: Giá trị định lượng để đo lường (doanh thu, số lượng, thời lượng, điểm)
- **Thời gian**: Ngày và timestamp (`created_at`, `updated_at`, `event_date`)
- **Văn bản**: Trường văn bản tự do (mô tả, ghi chú, tên)
- **Boolean**: Cờ true/false
- **Cấu trúc**: JSON, mảng, cấu trúc lồng nhau

### 3. Tạo hồ sơ dữ liệu

Thực hiện các kiểm tra sau:

**Ở cấp bảng:**
- Tổng số hàng
- Số cột và phân bố kiểu dữ liệu
- Kích thước xấp xỉ nếu metadata có cung cấp
- Khoảng ngày bao phủ, tức min/max của các cột ngày

**Với mọi cột:**
- Số lượng và tỷ lệ null
- Số lượng giá trị phân biệt và tỷ lệ cardinality (phân biệt / tổng)
- 5-10 giá trị phổ biến nhất cùng tần suất
- 5 giá trị ít phổ biến nhất để phát hiện bất thường

**Cột số (chỉ số):**
```
min, max, trung bình, trung vị (p50)
độ lệch chuẩn
các phân vị: p1, p5, p25, p75, p95, p99
số lượng giá trị 0
số lượng giá trị âm (nếu không được kỳ vọng)
```

**Cột chuỗi (chiều dữ liệu, văn bản):**
```
độ dài nhỏ nhất, lớn nhất, trung bình
số lượng chuỗi rỗng
phân tích mẫu định dạng
tính nhất quán chữ hoa/chữ thường
số lượng khoảng trắng đầu/cuối
```

**Cột ngày/timestamp:**
```
ngày nhỏ nhất, lớn nhất
ngày null
ngày trong tương lai (nếu không được kỳ vọng)
phân phối theo tháng/tuần
khoảng trống trong chuỗi thời gian
```

**Cột Boolean:**
```
số lượng true, false, null
tỷ lệ true
```

**Trình bày hồ sơ dưới dạng bảng tóm tắt rõ ràng**, nhóm theo loại cột (chiều dữ liệu, chỉ số, ngày, ID).

### 4. Xác định vấn đề chất lượng dữ liệu

Áp dụng khung đánh giá bên dưới và đánh dấu các vấn đề tiềm ẩn:

- **Tỷ lệ null cao**: >5% là cảnh báo; >20% là nghiêm trọng
- **Cardinality thấp bất ngờ**: Cột lẽ ra có cardinality cao nhưng lại thấp, ví dụ `user_id` chỉ có 50 giá trị
- **Cardinality cao bất ngờ**: Cột lẽ ra là phân loại nhưng có quá nhiều giá trị
- **Giá trị đáng ngờ**: Số âm khi chỉ kỳ vọng số dương, ngày tương lai trong dữ liệu lịch sử, placeholder như `N/A`, `TBD`, `test`, `999999`
- **Bản ghi trùng**: Kiểm tra khóa tự nhiên và các giá trị trùng
- **Phân phối lệch**: Phân phối số lệch mạnh có thể ảnh hưởng đến trung bình
- **Vấn đề mã hóa**: Chữ hoa/thường lẫn lộn, khoảng trắng cuối, định dạng không nhất quán

### 5. Khám phá quan hệ và mẫu hình

Sau khi lập hồ sơ từng cột, tìm:

- **Ứng viên khóa ngoại**: Các cột ID có thể liên kết với bảng khác
- **Hệ phân cấp**: Các cột tạo thành đường drill-down tự nhiên (quốc gia > tỉnh/bang > thành phố)
- **Tương quan**: Các cột số biến động cùng nhau
- **Cột dẫn xuất**: Cột có vẻ được tính từ cột khác
- **Cột dư thừa**: Cột chứa thông tin giống hoặc gần giống nhau

### 6. Đề xuất chiều dữ liệu và chỉ số đáng chú ý

Dựa trên hồ sơ cột, đề xuất:

- Cột chiều dữ liệu tốt nhất để phân lớp dữ liệu, thường có 3-50 giá trị
- Cột chỉ số chính có phân phối mang ý nghĩa
- Cột thời gian phù hợp để phân tích xu hướng
- Nhóm hoặc hệ phân cấp tự nhiên
- Khóa join tiềm năng liên kết với bảng khác

### 7. Đề xuất phân tích tiếp theo

Đề xuất 3-5 phân tích cụ thể, chẳng hạn:

- "Phân tích xu hướng [chỉ_số] theo [cột_thời_gian], nhóm theo [chiều_dữ_liệu]"
- "Phân tích sâu phân phối của [cột_bị_lệch] để hiểu ngoại lệ"
- "Điều tra chất lượng dữ liệu của [cột_có_vấn_đề]"
- "Phân tích tương quan giữa [chỉ_số_a] và [chỉ_số_b]"
- "Phân tích cohort bằng [cột_ngày] và [cột_trạng_thái]"

## Định dạng đầu ra

```
## Hồ sơ dữ liệu: [tên_bảng]

### Tổng quan
- Số hàng: 2.340.891
- Số cột: 23 (8 chiều dữ liệu, 6 chỉ số, 4 ngày, 5 ID)
- Khoảng ngày: 2021-03-15 đến 2024-01-22

### Chi tiết cột
[bảng tóm tắt]

### Vấn đề chất lượng dữ liệu
[vấn đề được đánh dấu cùng mức độ nghiêm trọng]

### Khám phá được đề xuất
[danh sách đánh số các phân tích tiếp theo]
```

---

## Khung đánh giá chất lượng

### Điểm đầy đủ

Đánh giá từng cột:
- **Đầy đủ** (>99% khác null): Xanh lá
- **Gần như đầy đủ** (95-99%): Vàng; điều tra các giá trị null
- **Không đầy đủ** (80-95%): Cam; tìm hiểu nguyên nhân và mức độ ảnh hưởng
- **Thưa** (<80%): Đỏ; có thể không dùng được nếu không bù dữ liệu

### Kiểm tra tính nhất quán

Tìm các vấn đề:
- **Định dạng giá trị**: Cùng khái niệm được biểu diễn khác nhau (`USA`, `US`, `United States`, `us`)
- **Kiểu dữ liệu**: Số lưu dưới dạng chuỗi, ngày có nhiều định dạng
- **Toàn vẹn tham chiếu**: Khóa ngoại không khớp bản ghi cha
- **Quy tắc nghiệp vụ**: Số lượng âm, ngày kết thúc trước ngày bắt đầu, tỷ lệ >100
- **Giữa các cột**: `status = "completed"` nhưng `completed_at` là null

### Dấu hiệu về độ chính xác

- **Placeholder**: `0`, `-1`, `999999`, `N/A`, `TBD`, `test`, `xxx`
- **Giá trị mặc định**: Một giá trị xuất hiện với tần suất cao đáng ngờ
- **Dữ liệu cũ**: `updated_at` không có thay đổi gần đây trong hệ thống đang hoạt động
- **Giá trị bất khả thi**: Tuổi >150, ngày quá xa trong tương lai, thời lượng âm
- **Thiên lệch số tròn**: Mọi giá trị kết thúc bằng 0 hoặc 5, gợi ý dữ liệu ước lượng

### Đánh giá tính kịp thời

- Bảng được cập nhật lần cuối khi nào?
- Tần suất cập nhật kỳ vọng là gì?
- Có độ trễ giữa thời gian sự kiện và thời gian nạp không?
- Chuỗi thời gian có khoảng trống không?

## Kỹ thuật khám phá mẫu hình

### Phân tích phân phối

Với cột số, mô tả phân phối:
- **Chuẩn**: Trung bình và trung vị gần nhau, hình chuông
- **Lệch phải**: Đuôi dài phía giá trị cao, thường gặp ở doanh thu và thời lượng phiên
- **Lệch trái**: Đuôi dài phía giá trị thấp
- **Hai đỉnh**: Hai đỉnh gợi ý hai quần thể khác nhau
- **Luật lũy thừa**: Ít giá trị rất lớn và nhiều giá trị nhỏ, thường gặp ở hoạt động người dùng
- **Đều**: Tần suất gần bằng nhau trên toàn phạm vi, thường là dữ liệu tổng hợp hoặc ngẫu nhiên

### Mẫu hình thời gian

Tìm xu hướng dài hạn, tính mùa vụ, hiệu ứng theo ngày trong tuần, hiệu ứng ngày lễ, điểm thay đổi và các điểm bất thường.

### Khám phá phân khúc

- Tìm cột phân loại có 3-20 giá trị
- So sánh phân phối chỉ số giữa các phân khúc
- Tìm phân khúc có hành vi khác biệt đáng kể
- Kiểm tra phân khúc có đồng nhất hay còn chứa phân khúc con

### Khám phá tương quan

- Tính ma trận tương quan cho mọi cặp chỉ số
- Đánh dấu tương quan mạnh (|r| > 0,7) để điều tra
- Ghi rõ rằng tương quan không hàm ý nhân quả
- Kiểm tra quan hệ phi tuyến như bậc hai hoặc logarit

## Hiểu và lập tài liệu schema

### Mẫu tài liệu schema

```markdown
## Bảng: [schema.tên_bảng]

**Mô tả**: [Bảng đại diện cho điều gì]
**Grain**: [Mỗi hàng đại diện cho...]
**Khóa chính**: [cột]
**Số hàng**: [xấp xỉ, kèm ngày]
**Tần suất cập nhật**: [thời gian thực / giờ / ngày / tuần]
**Chủ sở hữu**: [nhóm hoặc cá nhân chịu trách nhiệm]

### Các cột chính

| Cột | Kiểu | Mô tả | Giá trị ví dụ | Ghi chú |
|---|---|---|---|---|
| user_id | STRING | Định danh người dùng duy nhất | "usr_abc123" | FK tới users.id |
| event_type | STRING | Loại sự kiện | "click", "view", "purchase" | 15 giá trị phân biệt |
| revenue | DECIMAL | Doanh thu giao dịch bằng USD | 29.99, 149.00 | Null với sự kiện không mua hàng |
| created_at | TIMESTAMP | Thời điểm xảy ra sự kiện | 2024-01-15 14:23:01 | Phân vùng theo cột này |

### Quan hệ
- Join với `users` theo `user_id`
- Join với `products` theo `product_id`
- Bảng cha của `event_details` (1:nhiều theo event_id)

### Vấn đề đã biết
- [Liệt kê vấn đề chất lượng dữ liệu]
- [Ghi chú các điểm nhà phân tích cần chú ý]

### Mẫu truy vấn phổ biến
- [Các trường hợp sử dụng điển hình của bảng này]
```

### Truy vấn khám phá schema

```sql
-- Liệt kê mọi bảng trong một schema (PostgreSQL)
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Chi tiết cột (PostgreSQL)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'my_table'
ORDER BY ordinal_position;

-- Kích thước bảng (PostgreSQL)
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- Số hàng cho mọi bảng (mẫu tổng quát)
-- Chạy cho từng bảng: SELECT COUNT(*) FROM table_name
```

### Dòng dữ liệu và phụ thuộc

1. Bắt đầu từ các bảng đầu ra mà báo cáo hoặc dashboard sử dụng
2. Lần ngược lên các bảng nguồn
3. Xác định các lớp raw, staging và mart
4. Lập bản đồ chuỗi biến đổi từ dữ liệu thô đến bảng phân tích
5. Ghi lại nơi dữ liệu được làm giàu, lọc hoặc tổng hợp

## Mẹo

- Với bảng rất lớn (trên 100 triệu hàng), mặc định dùng lấy mẫu khi lập hồ sơ; hãy nêu rõ nếu cần số đếm chính xác
- Khi lần đầu khám phá tập dữ liệu mới, lệnh này giúp có cái nhìn tổng thể trước khi viết truy vấn cụ thể
- Các cảnh báo chất lượng chỉ mang tính heuristic; không phải cảnh báo nào cũng là vấn đề thực, nhưng đều đáng kiểm tra nhanh
