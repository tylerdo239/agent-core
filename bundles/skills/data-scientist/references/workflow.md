# Quy trình thực hiện công việc

Mọi flow dùng chung một pipeline. Flow ngắn vào và ra giữa chừng; full
engagement chạy từ đầu đến cuối. Phase tuần tự nhưng phát hiện có thể buộc quay
lại: EDA có thể sửa framing, review thất bại mở lại modeling. Không được nhảy
cóc: không modeling trước EDA, không reporting trước review.

## Phase 0 — Setup

Tạo `ds-workspace/{project-slug}/`, sao chép `templates/project-brief.md` và lưu
mọi artifact sau đó tại đây.

## Phase 1 — Framing

Đọc `references/framing.md`. Hoàn thành `project-brief.md` gồm quyết định, cấp độ
câu hỏi, unit of analysis, target/quantity và định nghĩa “đủ tốt để hành động”.
Không viết code phân tích khi chưa biết điều gì sẽ thay đổi dựa trên kết quả.
Yêu cầu hẹp có thể chỉ cần brief năm dòng nhưng vẫn phải viết.

## Phase 2 — Data audit

Chạy `scripts/profile_data.py` cho từng input, đọc warning trước rồi thực hiện
`checklists/data-quality.md`. Đầu ra là `data-profile.md` và phán quyết dữ liệu
có phù hợp câu hỏi không. Target không tạo được, grain sai hay history quá ngắn
là kết quả cần báo sớm, không phải thất bại.

## Phase 3 — EDA

Đọc `references/eda.md` và khám phá theo câu hỏi, không tham quan mọi column.
Tạo `eda-report.md` với danh sách giả thuyết xếp hạng, candidate feature và bẫy
leakage. Với flow Explore, kết thúc và bàn giao tại đây.

## Phase 4 — Phân tích hoặc modeling

- **Diagnostic/Inquire:** đọc `references/statistics.md`, chọn test, kiểm tra
  assumption, tính effect size và CI; tuân chuẩn causality trước khi nói “bởi vì”.
- **Predictive/Predict:** đọc `references/modeling.md`, chạy
  `scripts/baseline_model.py`, sau đó mới thử feature, model mạnh hơn và tuning.
  Ghi mọi run vào `experiment-log.md` trước ý tưởng tiếp theo.

## Phase 5 — Validation

Với model, đọc `references/evaluation.md`, chạy `checklists/leakage.md` và xác
nhận model thắng baseline nhiều hơn CV spread. Với statistics, xác minh
assumption và practical significance. Tạo `model-card.md` cho kết quả tái sử dụng.

## Phase 6 — Review gate

Đổi vai và chạy `checklists/analysis-review.md` như thể đối thủ viết phân tích.
Phần không đứng vững quay lại Phase 4; lo ngại còn lại đi vào Limitations.

## Phase 7 — Communication

Đọc `references/communication.md`, tạo `insight-report.md`: answer first,
evidence second, limitations trung thực, recommendation có trade-off định lượng
và quyết định cuối trả về owner.

## Điểm vào/ra

| Flow | Vào | Ra | Ghi chú |
|---|---|---|---|
| Full engagement | 0 | 7 | Toàn pipeline |
| Explore | 0 | 3 | Brief tối giản; hypotheses là handoff |
| Inquire | 0 | 6 | Phase 2–3 có thể rút gọn nhưng không bỏ |
| Predict | 0 | 6, hoặc 7 nếu được yêu cầu | Baseline bắt buộc |
| Review | 6 | 6 | Áp checklist cho công việc người khác |
| Communicate | 7 | 7 | Xác minh số liệu truy được về code |

Inquire vẫn phải profile dữ liệu. Communicate không được “rửa” số chưa xác
minh: hoặc chạy lại phép tính, hoặc đánh dấu rõ số do người dùng cung cấp.
