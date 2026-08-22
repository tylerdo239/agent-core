# Cổng kiểm tra Leakage

Chạy trước khi tin, chưa nói đến báo cáo, bất kỳ validation metric nào (nguyên
tắc bắt buộc số 5). Leakage nghĩa là model được tiếp cận thông tin không tồn tại
tại thời điểm ra quyết định; nó thổi phồng mọi metric và biến mất khi production.
**Prior: score tốt bất ngờ phải được xem là leakage cho đến khi chứng minh ngược
lại.** AUC tăng từ 0,75 lên 0,97 nhờ một feature không phải đột phá; đó là yêu
cầu điều tra feature ấy.

## Semantic leakage — feature mã hóa outcome

Với mọi feature, hỏi: **giá trị này có thể biết tại thời điểm prediction được
tạo không?** Kiểm tra semantics thời gian, không chỉ tên feature.

- [ ] Không có field hậu outcome như cancellation reason, refund flag,
      days_to_churn, final invoice amount hay bất kỳ field được điền *do*
      outcome đã xảy ra.
- [ ] Không có field bị cập nhật hồi tố, như cột `status` hoặc `segment` mang
      giá trị hôm nay cho row lịch sử vì CRM đã ghi đè history.
- [ ] Aggregate feature chỉ dùng quá khứ của từng row. “Average order value của
      khách hàng” tính trên toàn bộ thời gian sẽ chứa order sau prediction;
      rolling window phải neo tại prediction time.
- [ ] Transform dựa trên target như target encoding và outcome rate theo
      category chỉ được fit bên trong training fold.
- [ ] Đọc lại dòng “available at decision time” trong framing brief và áp dụng
      nó cho danh sách feature cuối.

## Mechanical leakage — pipeline gian lận

- [ ] Mọi preprocessing như imputation, scaling, encoding, feature selection
      và resampling được fit trong training fold; cross-validate toàn pipeline,
      không phải dữ liệu đã transform trước.
- [ ] Không có cùng entity ở nhiều split. Cùng customer/device/document trong
      train và test biến khả năng ghi nhớ thành score; dùng group split khi một
      entity có nhiều row.
- [ ] Tôn trọng thời gian: training data phải đứng trước validation data khi
      prediction nhằm vào tương lai; không random shuffle time series.
- [ ] Không có row duplicate hoặc near-duplicate nằm hai phía của split.
      `baseline_model.py` báo exact duplicate; near-duplicate cần kiểm tra theo
      subset key.
- [ ] Test/holdout chỉ được dùng đúng một lần bởi model cuối, không được xem khi
      feature selection hoặc model choice.

## Probe phát hiện — khi nghi ngờ, hãy kiểm tra

- [ ] **Single-feature probe:** một feature đơn lẻ đạt gần hoàn hảo, chẳng hạn
      AUC > 0,9 — `baseline_model.py` có quét — là nghi phạm leakage; truy
      lineage trước khi giữ.
- [ ] **Too-good-vs-baseline probe:** model cuối vượt xa linear baseline và cả
      mức domain intuition cho là có thể, như churn AUC 0,99 → tìm leakage.
- [ ] **Importance probe:** một feature không ai kỳ vọng lại thống trị ranking
      importance → điều tra leakage trước; xem `references/interpretation.md`.
- [ ] **Time-shuffle probe:** nếu random split cao hơn nhiều time-based split,
      khoảng cách đo lợi ích model thu được từ việc nhìn tương lai; con số
      time-based mới là thật.

## Phán quyết

Ghi vào `experiment-log.md` và `model-card.md`: các mục đã kiểm tra, feature đáng
ngờ đã điều tra cùng quyết định xử lý, và probe đã chạy. Metric được báo cáo mà
không có dấu xác nhận của cổng này chỉ là một tuyên bố, chưa phải kết quả.
