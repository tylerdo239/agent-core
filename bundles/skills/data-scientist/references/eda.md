# Phân tích dữ liệu khám phá

EDA là khám phá có định hướng: bắt đầu với framing question và kết thúc bằng
hiểu biết dữ liệu đã xác minh cùng danh sách giả thuyết được xếp hạng. Nó không
phải nghi thức in `df.describe()`; mỗi lần nhìn dữ liệu phải trả lời “có thể tin
dữ liệu này không?” hoặc “điều gì có thể giải thích outcome?”. Bắt đầu từ output
của `profile_data.py`; tài liệu này bổ sung lớp phán đoán.

## Thứ tự thực hiện

### 1. Integrity — có thể tin dữ liệu không?

- Đối chiếu row count với thực tế. Sai lệch lớn thường do grain bị nhân bản hoặc
  extract đã lọc; giải quyết trước mọi việc khác.
- Xác nhận primary key unique. Nếu không, hiểu nguyên nhân trước khi deduplicate
  vì retry hay amendment có thể là duplicate hợp lệ.
- Kiểm tra date range, truncation, timezone và spike tại giá trị ngày mặc định.
- Kiểm tra consistency giữa field: tổng phải cộng khớp, thứ tự ngày hợp lý và
  category có quan hệ lồng đúng.

### 2. Univariate — từng biến trông thế nào?

Chỉ tập trung biến liên quan câu hỏi. Xem distribution chứ không chỉ mean:
skew, multimodality, zero inflation và giá trị bất khả thi có thể ẩn sau mean.
Missingness mang thông tin; xác định thiếu vì không tồn tại, không được ghi nhận
hay do outcome. Chỉ drop row khi missingness không liên quan outcome; nếu không,
impute và/hoặc thêm missing indicator rồi giải thích lựa chọn. Điều tra outlier
trước khi xóa; báo cáo kết quả cả khi giữ và loại nếu quyết định ảnh hưởng lớn.

### 3. Bivariate — điều gì liên quan outcome?

- So target với candidate driver bằng mean/rate theo category, bin hoặc scatter
  cho numeric; ưu tiên rate trong nhóm hơn raw count.
- Correlation cao bất thường với target là nghi phạm leakage trước khi là feature tốt.
- Kiểm tra correlation giữa driver vì collinearity làm coefficient và importance
  khó diễn giải.
- Luôn thử ít nhất một split-by theo region, plan hoặc cohort để phát hiện
  Simpson's paradox.

### 4. Cấu trúc thời gian

Nếu có date, plot outcome theo thời gian để tìm trend, seasonality, level shift
và data gap. Tìm regime change trong chính dữ liệu như field chỉ được điền từ
một năm hoặc category đổi tên. Với prediction, ghi nhận ngay time structure để
chọn validation split trong `references/modeling.md`.

## Đầu ra

Điền `templates/eda-report.md`, tập trung vào:

- Điều hiện có thể tin về grain, coverage, quality và các điểm đặc biệt.
- Các giả thuyết có thể bác bỏ, bằng chứng gợi ý và phân tích để xác nhận.
- Watchlist leakage nếu bước tiếp theo là modeling.

Mọi claim phải đến từ code đã chạy. Ghi ngắn dead end để vòng sau không khám phá
lại. Chỉ tạo chart khi nó mang một kết luận đến người đọc.
