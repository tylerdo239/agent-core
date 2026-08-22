# Cổng kiểm tra chất lượng dữ liệu

Chạy sau `profile_data.py` và trước mọi phân tích. Trả lời từng mục bằng bằng
chứng như số đã tính hoặc ví dụ đã kiểm tra, không dựa trên giả định. Mục không
thể xác minh phải được ghi vào `project-brief.md` như rủi ro đang mở; không xác
minh được là một phát hiện, không phải đã đạt.

## Nguồn gốc và độ bao phủ

- [ ] Dữ liệu đến từ đâu và đã bị lọc thế nào trước khi tới đây? Extract “khách
      hàng đang hoạt động” có thể âm thầm loại đúng những người churn cần nghiên
      cứu, tạo survivorship ngay trong file.
- [ ] Row count khớp thực tế: N có đúng với số lượng và grain người dùng tin là
      tồn tại không?
- [ ] Khoảng thời gian phù hợp câu hỏi: đủ lịch sử, không bị cắt ngầm ở hai đầu,
      và kỳ gần nhất đã đầy đủ. Dữ liệu tuần trước còn chảy vào có thể giả dạng
      một đợt suy giảm.
- [ ] Đây có phải sample không? Nếu có, được lấy thế nào? Sample không ngẫu nhiên
      giới hạn mọi kết luận vào đúng quần thể đã được lấy mẫu.

## Cấu trúc

- [ ] Primary key đã được xác nhận unique; nếu không, duplicate đã được giải
      thích và quy tắc deduplication đã được quyết định, ghi lại.
- [ ] Grain đã rõ: một row đại diện cho gì? Join upstream có thể nhân dòng và
      làm doanh thu bị đếm lặp theo từng order line.
- [ ] Ý nghĩa mọi column được sử dụng đã được xác nhận từ data dictionary hoặc
      người dùng, không đoán theo tên. `status=3` vô nghĩa nếu chưa được giải thích.

## Giá trị

- [ ] Missingness của các cột chính đã được xem xét cùng giả thuyết về cơ chế
      gây thiếu; xem `references/eda.md`, đặc biệt kiểm tra missingness có liên
      quan outcome không.
- [ ] Đã tìm placeholder bằng frequency: 0, -1, 999, 1900-01-01, "N/A",
      "unknown", chuỗi rỗng; và quyết định mỗi loại là missing hay giá trị thật.
- [ ] Range hợp lý: không có quantity âm, tuổi trên 120 hoặc ngày tương lai trừ
      khi có lý do hợp lệ.
- [ ] Unit và currency nhất quán. EUR/USD hoặc seconds/ms trộn trong một cột
      thường xuất hiện sau migration. Timestamp không timezone từ các nguồn
      khác nhau có thể không so sánh được.
- [ ] Category nhất quán: “VN”, “Vietnam”, “Viet Nam”; khác biệt hoa thường;
      category bị đổi tên giữa lịch sử.

## Tính toàn vẹn của target (nếu có)

- [ ] Target được chính bạn tạo bằng code theo operational definition trong
      brief, không mặc nhiên tin một cột tính sẵn không rõ lineage.
- [ ] Target rate/distribution đã được đối chiếu hiểu biết nghiệp vụ, ví dụ
      “40% churn mỗi tháng có hợp lý không?”.
- [ ] Loại các row mà outcome chưa thể biết vì vẫn nằm trong observation
      window, không gán chúng thành negative.
- [ ] Hiểu timing của label: label được gán khi nào và có thể bị sửa sau đó
      không? Fraud label trưởng thành qua nhiều tháng nên tháng gần đây thường
      thiếu label.

## Phán quyết

Kết thúc bằng một trong ba mức: **phù hợp mục đích** / **phù hợp với caveat đã
ghi nhận** (liệt kê và chuyển sang Limitations) / **không phù hợp** (nêu dữ liệu
còn thiếu và dừng; đề xuất thu thập dữ liệu tốt hơn là một kết quả hợp lệ).
