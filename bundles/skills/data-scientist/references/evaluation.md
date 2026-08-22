# Đánh giá: metric và phán đoán

Model không “tốt” một cách tuyệt đối; nó chỉ tốt cho một quyết định, dưới một
trade-off chi phí và khi so với baseline.

## Chọn metric từ chi phí sai lầm

Quay lại framing brief: lỗi nào đắt hơn? Câu trả lời này, không phải thói quen,
quyết định metric.

### Classification

| Tình huống | Metric | Ghi chú |
|---|---|---|
| Class cân bằng, chi phí đối xứng | Accuracy | Trường hợp hiếm hoi accuracy đủ dùng |
| Đánh giá ranking, chưa chọn threshold | ROC-AUC | Không nhạy prevalence; dễ gây ảo tưởng với imbalance |
| Positive hiếm như fraud/churn | **PR-AUC** và precision/recall tại threshold | ROC-AUC cao vẫn có thể đi cùng precision vô dụng |
| Probability dùng cho expected value/pricing | Calibration và Brier score/log loss | Phải kiểm tra calibration |
| Chỉ có capacity xử lý top k | precision@k hoặc lift@k | Khớp vận hành thực tế |

**Threshold là quyết định kinh doanh, không mặc định 0,5.** Trình bày 3–4
threshold cùng hệ quả: tỷ lệ bị flag, recall fraud và false alarm. Tính bảng là
nhiệm vụ của analyst; chọn row là nhiệm vụ của decision owner. Nếu score được
đọc như probability, kiểm tra reliability curve và cân nhắc
`CalibratedClassifierCV`.

### Regression và forecasting

| Tình huống | Metric |
|---|---|
| Error gây hại tuyến tính | MAE |
| Error lớn gây hại mạnh hơn | RMSE |
| Relative error quan trọng | MAPE cẩn trọng gần 0; cân nhắc wMAPE/sMAPE |
| Target dương bị skew | MAE trên log scale hoặc quantile loss |

Luôn báo error cùng scale target, ví dụ “MAE 12,4 ngày trên median 30 ngày”.
Forecast phải dùng rolling-origin backtest và so với naive forecast như last
value hoặc cùng kỳ mùa trước.

## Đọc metric trung thực

- Báo CV mean ± std; với final holdout dùng bootstrap CI. Chênh 0,004 khi fold
  std là 0,01 chỉ là noise.
- Đặt metric cạnh cả dummy và linear baseline.
- Tính metric theo segment, cohort, product và time period; global winner có thể
  thất bại ở nhóm quan trọng hoặc giai đoạn gần nhất.
- Đọc trực tiếp khoảng 20 error tệ nhất để tìm feature idea, leakage và label issue.

## Phán quyết

Ghi trong `model-card.md`: model có vượt success bar không; khi sai tốn gì và ai
chịu; không hoạt động ở đâu; điều kiện nào phải đúng ở production. Trước đó phải
chạy `checklists/leakage.md` rồi `checklists/analysis-review.md`.
