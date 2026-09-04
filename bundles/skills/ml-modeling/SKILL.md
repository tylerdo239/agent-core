---
name: ml-modeling
description: Xây dựng và thẩm định mô hình máy học cổ điển trên dữ liệu bảng — thiết kế feature an toàn không rò rỉ, chọn và huấn luyện mô hình (linear, tree ensemble, SVM, clustering, giảm chiều), tinh chỉnh siêu tham số, rồi đánh giá bằng baseline thật, chỉ số khớp bài toán kinh doanh, khoảng tin cậy, phân tích lỗi theo lát cắt và kiểm tra hiệu chuẩn. Dùng khi cần dự đoán, phân loại, phân cụm, hoặc khi cần phán quyết một mô hình đã huấn luyện có nên đưa vào dùng hay không.
drivers: rlm
---

# ml-modeling — từ feature tới phán quyết go/no-go

Gộp ba skill trước đây (`ml-feature-engineering`,
`scikit-learn-machine-learning`, `model-evaluation-report`) vì chúng là ba
chặng của cùng một quy trình, và tách rời khiến chặng giữa hay bị làm mà bỏ
qua hai chặng đầu-cuối — chỗ sinh ra hầu hết sai lầm thật.

## Thứ tự bắt buộc

1. **Feature trước, mô hình sau.** Mã hoá categorical theo cardinality, biến
   đổi numeric có lý do, và trên hết: **không rò rỉ**. Mọi phép biến đổi học
   từ dữ liệu phải nằm trong pipeline và chỉ fit trên tập train.
2. **Baseline trước, mô hình phức tạp sau.** Không có baseline thì không có
   cách nào biết mô hình có đáng gì không.
3. **Đánh giá bằng chỉ số khớp bài toán**, không phải accuracy mặc định.
   Kèm khoảng tin cậy, phân tích lỗi theo lát cắt, kiểm tra hiệu chuẩn.
4. **Kết luận go/no-go rõ ràng**, nêu điều kiện và rủi ro.

Hiệu năng offline đẹp bất thường là dấu hiệu rò rỉ cho tới khi chứng minh
được ngược lại — kiểm tra trước khi vui mừng.

## Tài nguyên

| Đọc khi | Tệp |
|---|---|
| Thiết kế/mã hoá feature, chẩn đoán rò rỉ | `references/feature-engineering-guide.md` |
| Chọn thuật toán, pipeline, tinh chỉnh siêu tham số | `references/sklearn-guide.md` |
| Viết báo cáo đánh giá, baseline, hiệu chuẩn, go/no-go | `references/model-evaluation-guide.md` |

Dữ liệu quá lớn cho pandas thì dùng DuckDB/PyArrow hoặc xử lý theo chunk.
Deep learning không thuộc phạm vi skill này.
