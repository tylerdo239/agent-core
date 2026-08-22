# Định hình: câu hỏi kinh doanh → bài toán dữ liệu

Framing quyết định thành bại. Model hoàn hảo cho target sai kém giá trị hơn câu
trả lời thô cho câu hỏi đúng. Điền `templates/project-brief.md` khi làm việc.

## Xác định cấp độ câu hỏi

| Cấp độ | Câu hỏi | Cách trả lời |
|---|---|---|
| Descriptive | Đã xảy ra gì? | Aggregate, EDA, segmentation |
| Diagnostic | Tại sao xảy ra? | Statistical comparison, causal analysis |
| Predictive | Khả năng điều gì xảy ra? | Supervised model |
| Prescriptive | Nên làm gì? | Khuyến nghị và trade-off định lượng |

Người dùng thường hỏi sai cấp độ. “Xây churn model” không hữu ích nếu không ai
hành động trên score từng customer, trong khi nguyên nhân churn tăng có thể dẫn
đến hành động. Hỏi câu trả lời sẽ làm thay đổi điều gì; hành động hé lộ cấp độ
thật. Prescriptive cần lõi predictive/diagnostic cộng decision layer. Phân tích
lõi nghiêm ngặt, trình bày đòn bẩy và trade-off rồi trả lựa chọn cho owner.

## Năm câu hỏi framing

Không đoán ngầm; hỏi người dùng hoặc ghi rõ assumption:

1. **Quyết định nào phụ thuộc kết quả?** Ai đưa ra và họ thực sự có thể làm gì?
   Nếu chỉ tò mò, thu phạm vi về Explore.
2. **Unit of analysis là gì?** Customer, order, session, day hay store-week?
   Grain mismatch là nguồn lỗi âm thầm phổ biến.
3. **Target/đại lượng quan tâm chính xác là gì?** “Churn” là operational
   definition gồm window, mốc ngày, inclusion và exclusion; phải viết và xác nhận.
4. **Thông tin nào thực sự có tại decision time?** Mọi thứ chưa biết lúc đó là
   leakage tiềm năng; xác định ranh giới ngay.
5. **Mức nào đủ tốt để hành động?** Thu thập theo ngôn ngữ kinh doanh rồi chuyển
   thành metric; đồng thời xác định cost asymmetry giữa false positive và false negative.

## Dịch lại rồi xác nhận

Kết thúc framing bằng một đoạn: “Tôi sẽ xem đây là bài toán [level]:
[target/quantity] tại grain [unit], dùng dữ liệu có tại [decision time], đánh giá
bằng [metric] với success bar [bar].” Đưa lại cho người dùng xác nhận.

## Anti-pattern

- **Solution-first:** người dùng yêu cầu kỹ thuật trước; vẫn định hình câu hỏi
  rồi mới chọn kỹ thuật.
- **Proxy drift:** proxy đo được âm thầm thay mục tiêu thật; ghi khoảng cách này
  vào brief và Limitations.
- **Boiling the ocean:** “phân tích mọi thứ” phải được thu về một hoặc hai quyết
  định, hoặc ghi rõ Explore chỉ tạo giả thuyết.
- **Yêu cầu không thể bác bỏ:** nếu không kết quả dữ liệu nào có thể thay đổi
  quan điểm, hãy nói rõ và định hình lại.
