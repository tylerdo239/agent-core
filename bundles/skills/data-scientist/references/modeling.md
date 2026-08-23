# Xây dựng mô hình dự đoán

Mục tiêu không phải score cao nhất mà là model tổng quát hóa, tái lập được và
hữu ích cho quyết định. Chỉ modeling sau framing, data audit và EDA.

## Trước khi fit

1. Chốt operational definition của target, prediction time, observation window
   và outcome window. Loại row chưa đủ thời gian quan sát outcome.
2. Chọn split phản ánh deployment:

| Cấu trúc dữ liệu | Split |
|---|---|
| Row độc lập | stratified k-fold CV cho classification |
| Có thời gian và dự đoán tương lai | train quá khứ → validate tương lai |
| Nhiều row trên một entity | group split bằng `GroupKFold` |
| Có cả time và group | ưu tiên time rồi kiểm tra entity overlap |

Giữ một final holdout nguyên vẹn đến cuối và chỉ dùng một lần. Mọi experiment
khác chạy CV trên training portion.

3. Đặt toàn bộ transform học từ dữ liệu — imputation, scaling, encoding,
feature selection, resampling — trong `Pipeline`/`ColumnTransformer` để chỉ fit
trên training fold. Preprocess toàn dataset trước split là leakage.

## Thang độ phức tạp

### Bậc 0–1: dummy và linear

Luôn chạy `scripts/baseline_model.py`. Dummy định chuẩn độ khó; linear cho biết
lượng signal tuyến tính và tạo baseline có thể giải thích.

### Bậc 2: gradient-boosted tree

Với tabular business data, HistGradientBoosting, XGBoost hoặc LightGBM là mặc
định mạnh và hợp lý. Chạy default trước; khoảng cách linear → GBM đo phần
nonlinearity. Deep learning tabular chỉ đáng dùng nếu thắng tuned GBM đủ để bù
chi phí.

### Bậc 3: feature engineering

Thường có giá trị hơn tuning: aggregate theo entity, count/sum/recency, ratio,
feature thời gian và target encoding cardinality cao. Target encoding phải fit
trong fold. Với mỗi feature, hỏi nó có sẵn tại decision time không. Ghi từng
batch vào experiment log và xóa feature không cải thiện validation.

### Bậc 4: tuning

Thực hiện cuối cùng với budget cố định, randomized/Bayesian search trên vài
parameter quan trọng và CV trong training data. Nhiều experiment làm best CV
score bị optimistic bias; final holdout dùng để phát hiện điều đó.

## Class imbalance

- Đánh giá bằng PR-AUC và precision/recall, không chỉ accuracy.
- Ưu tiên `class_weight='balanced'`; nếu resample, chỉ resample training fold,
  không bao giờ validation data.
- Không mặc định ép training set về 50/50; GBM thường xử lý imbalance vừa phải
  tốt và resampling có thể phá calibration.

## Experiment log và điểm dừng

Trước ý tưởng tiếp theo, append vào `experiment-log.md`: data version, split,
feature, model/params, CV mean ± std và điều học được. Dừng khi đạt success bar;
hai bậc liên tiếp cải thiện nhỏ hơn CV std; hoặc phần thiếu còn lại rõ ràng là
vấn đề dữ liệu/label chứ không phải model. Sau đó đọc
`references/evaluation.md`, chạy `checklists/leakage.md` và ghi winner vào
`model-card.md`.
