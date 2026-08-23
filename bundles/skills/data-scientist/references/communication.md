# Truyền đạt kết quả

Sản phẩm của một công việc không phải model hay notebook mà là một quyết định
được cải thiện. Tài liệu này chi phối mọi nội dung stakeholder sẽ đọc, đặc biệt
là `insight-report.md`.

## Nguyên tắc

- **Trả lời trước.** Đoạn đầu nêu câu trả lời cho câu hỏi đã định hình bằng
  ngôn ngữ thông thường, kèm con số chính và uncertainty. Cấu trúc toàn bộ nội
  dung theo thứ tự câu trả lời → bằng chứng → chi tiết.
- **Luôn dùng đơn vị kinh doanh:** percentage point, khách hàng, ngày, tiền.
  Standardized effect size, AUC và thuật ngữ model để trong phụ lục.
- **Nói rõ uncertainty, không né tránh.** “Từ 0,9 đến 2,7 điểm, khả năng cao
  khoảng 1,8” vừa trung thực vừa dễ đọc. Nêu range rồi nói rõ khuyến nghị.
- **Ngôn ngữ nhân quả phải khớp bằng chứng.** Summary dùng causal claim yếu
  nhất trong chuỗi bằng chứng vì đây là phần thường được chuyển tiếp.
- **Bộ lọc ‘thì sao?’.** Mỗi phần phải thay đổi điều người đọc quyết định, thực
  hiện hoặc theo dõi; phát hiện thú vị nhưng không hữu ích chuyển xuống phụ lục.

## Insight report

Dùng `templates/insight-report.md` theo cấu trúc:

1. **Câu hỏi:** một dòng đã được xác nhận với người dùng.
2. **Câu trả lời:** phát hiện, quy mô theo đơn vị kinh doanh và độ tin cậy.
3. **Bằng chứng:** hai hoặc ba kết quả quan trọng, mỗi kết quả có số liệu,
   uncertainty và chart chỉ khi chart truyền tải điều text không thể.
4. **Khuyến nghị:** hành động cụ thể và trade-off đã định lượng. Với model, dùng
   threshold table từ `references/evaluation.md`; đề xuất một lựa chọn nhưng
   trả quyết định cuối cho owner.
5. **Limitations:** data gap, causal ambiguity, segment yếu và giả định cụ thể;
   không dùng câu chung chung như “cần thêm dữ liệu”.
6. **Phụ lục:** phương pháp, model card, bảng đầy đủ và phát hiện khám phá.

## Chart và con số

- Mỗi chart truyền một thông điệp, thể hiện ngay trong title dạng kết luận.
- Ưu tiên bar, line hoặc scatter dễ đọc trong ba giây; gắn nhãn trực tiếp.
- Thể hiện uncertainty bằng error bar, CI band hoặc độ phân tán qua fold.
- Không cắt trục bar để phóng đại và không dùng hai trục để ám chỉ correlation.
- Mọi số phải truy được về code đã chạy. Làm tròn theo độ chính xác dữ liệu hỗ
  trợ; `23.4712%` từ n=200 là false precision. Đánh dấu số do người dùng cung
  cấp nhưng chưa xác minh.

## Báo cáo phản biện

Với luồng Review, trình bày: phân tích đang tuyên bố gì → đã chạy kiểm tra nào →
phát hiện theo mức nghiêm trọng/đáng kể/nhỏ → cách làm cho phân tích vững hơn.
Xác minh mỗi phát hiện bằng code. Mục tiêu là cải thiện phân tích, không phải
tạo danh sách bắt lỗi; ghi nhận điểm làm tốt và biến mọi phê bình thành hành
động cụ thể.
