---
name: data-profiling
description: Lập hồ sơ và kiểm định chất lượng một dataset — cấu trúc, kiểu dữ liệu, tỷ lệ null, phân phối, giá trị bất thường, bản ghi trùng, toàn vẹn tham chiếu, độ tươi của dữ liệu, và đối chiếu với quy tắc nghiệp vụ. Dùng khi gặp một bảng/tệp mới chưa biết gì về nó, khi cần kiểm tra dữ liệu trước lúc phân tích hay đưa vào production, hoặc khi cần một bảng điểm chất lượng cho một data asset.
drivers: rlm
argument-hint: "<bảng hoặc tệp>"
---

# data-profiling — hiểu và kiểm định một dataset

Skill này gộp ba việc trước đây tách rời (`explore-data`, `validate-data`,
`data-quality-audit`) vì trong thực tế chúng luôn đi cùng nhau: không ai lập
hồ sơ một dataset mà không đồng thời phát hiện vấn đề chất lượng của nó.

## Khi nào dùng

- Vừa nhận một tệp/bảng mới, chưa biết nó chứa gì.
- Trước khi phân tích hoặc huấn luyện mô hình: cần biết dữ liệu có dùng được không.
- Cần một bảng điểm chất lượng để bàn giao hoặc để quyết định go/no-go.

## Quy trình

1. **Hồ sơ cấu trúc** — số dòng/cột, kiểu dữ liệu thật (không tin dtype mặc
   định), khoá dự kiến, quan hệ giữa các bảng.
2. **Hồ sơ giá trị** — tỷ lệ null theo cột, cardinality, phân phối, min/max,
   giá trị đại diện cho "thiếu" nhưng không phải null (`-1`, `""`, `N/A`,
   `1970-01-01`).
3. **Kiểm định** — trùng lặp, toàn vẹn tham chiếu, khoảng giá trị hợp lệ,
   độ tươi, và các quy tắc nghiệp vụ do người dùng nêu.
4. **Kết luận** — nêu rõ dữ liệu dùng được cho mục đích gì, hạn chế nào phải
   ghi chú lại, vấn đề nào phải sửa trước khi đi tiếp.

Không im lặng bỏ qua dòng lỗi. Mọi con số báo cáo phải kèm cách tính ra nó.

## Tài nguyên

| Đọc khi | Tệp |
|---|---|
| Cần quy trình khám phá đầy đủ, chi tiết từng bước | `references/explore-data-guide.md` |
| Cần bộ kiểm định sâu (schema, ràng buộc, edge case) | `references/validate-data-guide.md` |
| Cần dựng bảng điểm chất lượng để bàn giao | `references/quality-audit-guide.md` |
| Cần các chiều chất lượng chuẩn (completeness, validity, …) | `references/quality_dimensions.md` |
| Cần mẫu quy tắc nghiệp vụ thường gặp | `references/business_rule_patterns.md` |

`scripts/` có sẵn các script chạy được: `null_counter.py`,
`duplicate_finder.py`, `value_range_validator.py`,
`referential_integrity.py`, `freshness_check.py`.
