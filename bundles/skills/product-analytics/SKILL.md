---
name: product-analytics
description: Phân tích hành vi người dùng theo lát cắt — giữ chân theo nhóm đăng ký (cohort/retention), phễu chuyển đổi và điểm rơi rụng giữa các bước, và phân khúc khách hàng cùng chân dung từng nhóm. Dùng khi cần biết nhóm người dùng nào ở lại hay rời bỏ theo thời gian, người dùng rớt ở bước nào trong một hành trình nhiều bước, hoặc cần chia tập khách hàng thành các nhóm có ý nghĩa hành động được.
drivers: rlm
---

# product-analytics — cắt lát hành vi người dùng

Gộp `cohort-analysis`, `funnel-analysis`, `segmentation-analysis`: cả ba đều
là cùng một động tác — chia người dùng thành nhóm rồi so sánh hành vi giữa
các nhóm — chỉ khác trục chia (thời gian đăng ký / bước trong hành trình /
đặc điểm khách hàng).

## Chọn trục nào

| Câu hỏi của người dùng | Trục | Đọc |
|---|---|---|
| "Nhóm vào tháng 1 sau 6 tháng còn lại bao nhiêu?" | thời gian gia nhập | `references/cohort-analysis-guide.md` |
| "Người dùng rớt nhiều nhất ở bước nào?" | bước trong hành trình | `references/funnel-analysis-guide.md` |
| "Khách của tôi chia được thành mấy nhóm?" | đặc điểm khách hàng | `references/segmentation-analysis-guide.md` |

Rất thường xuyên câu trả lời tốt cần hai trục cùng lúc (ví dụ: phễu **theo
từng phân khúc**) — khi đó nêu rõ đang so sánh cái gì với cái gì.

## Kỷ luật chung

- Định nghĩa nhóm phải viết ra tường minh trước khi tính. Cùng một từ
  "người dùng hoạt động" có thể ra hai kết quả khác nhau.
- Nhóm quá nhỏ thì không kết luận — nêu cỡ mẫu cạnh mọi tỷ lệ.
- Chênh lệch giữa các nhóm phải kèm nhận định nó có đáng kể không, đừng chỉ
  đưa con số.

`references/` còn có `cohort_definition_patterns.md`,
`retention_metrics_glossary.md`, `funnel_design_guide.md`,
`segmentation_approaches.md`. `scripts/` có sẵn script chạy được cho cả ba
trục; `assets/` có mẫu báo cáo.
