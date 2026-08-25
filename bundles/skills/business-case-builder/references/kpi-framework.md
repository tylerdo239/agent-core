# Khung KPI — công thức, cách diễn giải, cách chọn

Mỗi KPI trong báo cáo cuối phải đủ 4 phần: **công thức**, **giá trị hiện
tại/ước tính** (kèm nguồn — số nội bộ do người dùng cung cấp, hay số ước tính
từ `web_search`, phải ghi rõ loại nào), **mục tiêu**, **khung thời gian**.

## 1. Growth / Revenue

| KPI | Công thức | Diễn giải |
|---|---|---|
| MRR (Monthly Recurring Revenue) | Tổng doanh thu định kỳ hàng tháng | Chỉ áp dụng mô hình subscription |
| ARR (Annual Recurring Revenue) | MRR × 12 | |
| MoM growth rate | (MRR tháng này − MRR tháng trước) ÷ MRR tháng trước | Tăng trưởng ngắn hạn |
| CAGR (Compound Annual Growth Rate) | (giá trị cuối ÷ giá trị đầu)^(1 ÷ số năm) − 1 | Tăng trưởng dài hạn, dùng cho quy mô thị trường hoặc doanh thu đa năm |
| GMV (Gross Merchandise Value) | Tổng giá trị giao dịch qua nền tảng | Mô hình marketplace, KHÔNG phải doanh thu thật của công ty |

## 2. Customer

| KPI | Công thức | Diễn giải |
|---|---|---|
| CAC (Customer Acquisition Cost) | Tổng chi phí marketing + sales trong kỳ ÷ số khách hàng mới trong kỳ | Tính đúng kỳ — không lấy chi phí cả năm chia khách hàng mới 1 tháng |
| ARPU (Average Revenue Per User) | Tổng doanh thu ÷ số khách hàng hoạt động | |
| Churn rate | Số khách hàng rời đi trong kỳ ÷ số khách hàng đầu kỳ | Có thể tính theo customer count hoặc theo revenue (revenue churn) — phải nói rõ đang dùng loại nào |
| LTV (Customer Lifetime Value) | ARPU × gross margin % ÷ churn rate | Công thức đơn giản hoá cho subscription; mô hình giao dịch đơn lẻ dùng LTV = giá trị đơn hàng trung bình × số lần mua/năm × số năm giữ chân trung bình |
| LTV:CAC ratio | LTV ÷ CAC | Ngưỡng tham khảo phổ biến trong ngành SaaS: ≥ 3 được coi là lành mạnh, < 1 nghĩa là lỗ trên mỗi khách hàng — đây là NGƯỠNG THAM KHẢO, không phải quy luật tuyệt đối, phải nêu rõ khi trích dẫn |
| NPS (Net Promoter Score) | % Promoter (9-10 điểm) − % Detractor (0-6 điểm), thang khảo sát 0-10 | Cần khảo sát thật, không tự ước lượng |

## 3. Financial / Unit economics

| KPI | Công thức | Diễn giải |
|---|---|---|
| Gross margin | (Doanh thu − giá vốn hàng bán) ÷ doanh thu | |
| Burn rate | Tiền mặt chi ra ròng mỗi tháng | Chỉ áp dụng giai đoạn công ty chưa hoà vốn |
| Runway | Tiền mặt hiện có ÷ burn rate hàng tháng | Đơn vị: số tháng còn hoạt động được nếu không có thêm doanh thu/vốn |
| CAC payback period | CAC ÷ (ARPU × gross margin %) | Số tháng để thu hồi chi phí thu hút 1 khách hàng |
| Break-even point | Chi phí cố định ÷ (giá bán − chi phí biến đổi trên 1 đơn vị) | Đơn vị sản phẩm cần bán để hoà vốn |

## 4. Operational

Không có danh sách cố định — phụ thuộc hoàn toàn vào mô hình vận hành cụ thể.
Cách chọn: xác định 2-3 bước trong chuỗi vận hành có ảnh hưởng lớn nhất đến
chi phí hoặc trải nghiệm khách hàng, rồi đo đúng bước đó. Ví dụ tham khảo
(KHÔNG áp dụng máy móc):

- Thương mại điện tử/logistics: fulfillment time, tỷ lệ giao hàng đúng hẹn, tỷ lệ hoàn hàng.
- SaaS/nền tảng: uptime, thời gian phản hồi hỗ trợ, defect/bug rate.
- Sản xuất/bán lẻ vật lý: inventory turnover = giá vốn hàng bán ÷ tồn kho trung bình, utilization rate.

## 5. Product / Engagement (chỉ áp dụng nếu có sản phẩm số)

| KPI | Công thức | Diễn giải |
|---|---|---|
| DAU/MAU | Daily Active Users ÷ Monthly Active Users | Đo độ "dính" (stickiness) của sản phẩm — càng gần 1 càng tốt |
| Activation rate | Số user hoàn thành hành động "kích hoạt" (vd. tạo project đầu tiên) ÷ tổng số user đăng ký | Định nghĩa "hành động kích hoạt" phải cụ thể theo sản phẩm |
| Retention curve | % user còn hoạt động tại ngày N sau khi đăng ký, theo từng N | Cần dữ liệu theo thời gian — nếu có dataset thật, dùng skill `time-series-analysis`/`cohort-analysis` đã có sẵn trong hệ thống thay vì tự phân tích lại, chỉ trích dẫn kết luận vào báo cáo |

## Chọn đúng tập con — bắt buộc, không liệt kê máy móc

Không đưa cả 5 nhóm vào mọi báo cáo. Ví dụ:

- **SaaS B2B**: bắt buộc có MRR/ARR, CAC, LTV, LTV:CAC, churn rate, CAC payback period. Có thể bỏ GMV (không áp dụng), bỏ hầu hết Operational.
- **Marketplace**: bắt buộc có GMV, take rate (hoa hồng ÷ GMV), CAC 2 phía (bên mua và bên bán tính riêng), churn rate 2 phía.
- **Retail truyền thống**: bắt buộc có gross margin, inventory turnover, break-even point. LTV/CAC vẫn dùng được nếu có chương trình khách hàng thân thiết, nhưng ít trọng tâm hơn SaaS.
- **Dịch vụ chuyên nghiệp** (tư vấn, agency...): utilization rate (% giờ công tính phí trên tổng giờ công), billing rate, project margin thay cho phần lớn KPI sản phẩm số.

Ghi rõ trong báo cáo VÌ SAO chọn tập KPI đó cho mô hình kinh doanh cụ thể —
đây là 1 phần của Nguyên tắc bắt buộc #4 trong `SKILL.md`.
