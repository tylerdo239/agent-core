# Model Card — {tên mô hình}

_Ngày: {} · Experiment log: run #{} · Dữ liệu: {file/version}_

## Mục đích

{Một đoạn: dự đoán điều gì, cho ai và phục vụ quyết định nào; lấy từ project brief.}

## Dữ liệu và feature

- **Training data:** {nguồn, giai đoạn, số row, grain, filter}
- **Target:** {operational definition}
- **Feature:** {số lượng, các nhóm, nơi lưu danh sách đầy đủ}
- **Phần loại trừ đã biết:** {segment/giai đoạn không được đại diện}

## Validation

- **Thiết kế split:** {và lý do nó phản ánh deployment}
- **Kết quả:**

| Model | {metric chính} | {metric phụ} |
|---|---|---|
| Dummy | | |
| Linear | | |
| **Final: {model}** | **mean ± std** | |

- **Holdout (chỉ dùng một lần):** {score, bootstrap CI}
- **Theo lát cắt:** {segment/giai đoạn tệ nhất và score}
- **Calibration:** {đã kiểm tra? phương pháp?}
- **Leakage gate:** {ngày chạy, nghi phạm đã điều tra và cách xử lý}

## Operating point đề xuất

{Bảng threshold hoặc tương đương, gồm lựa chọn và hệ quả theo đơn vị kinh doanh.
Row được chọn là quyết định của decision owner.}

## Driver chính (association, không phải causality)

1. {driver, chiều tác động, hình dạng, quy mô theo đơn vị kinh doanh}

## Limitations và giả định để kết quả còn hiệu lực

- {điều phải giữ đúng: distribution, feature có sẵn tại decision time, định
  nghĩa upstream}
- {lo ngại còn lại từ review gate}

## Tái lập

{Command/script và data version dùng để tái tạo kết quả.}
