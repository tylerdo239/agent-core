# Hướng dẫn — Phân tích khoa học

Phần này áp kỷ luật định lượng vào bối cảnh kịch bản kinh doanh. **Không viết
lại kỹ thuật thống kê/dự báo ở đây** — skill `statistical-analysis` và
`time-series-analysis` đã có sẵn trong hệ thống, điều phối dùng lại chúng khi
có dataset thật; file này chỉ nói RIÊNG về kỷ luật áp dụng cho ước lượng kinh
doanh (thị trường, doanh thu, chi phí) khi KHÔNG có dataset đầy đủ để chạy mô
hình thống kê chính quy.

## 1. Kịch bản best/base/worst — bắt buộc cho mọi ước lượng tài chính

Không đưa ra 1 con số điểm cho doanh thu/chi phí/quy mô thị trường dự kiến.
Với mỗi biến số quan trọng, xây 3 kịch bản:

- **Worst case** — giả định bi quan có căn cứ (vd. tốc độ chuyển đổi thấp hơn
  benchmark ngành, chi phí cao hơn ước tính ban đầu).
- **Base case** — giả định hợp lý nhất dựa trên số liệu đã thu thập qua
  `web_search` hoặc dữ liệu nội bộ người dùng cung cấp.
- **Best case** — giả định lạc quan có căn cứ, KHÔNG phải "mọi thứ đều thuận
  lợi nhất có thể" phi thực tế.

Mỗi kịch bản phải nêu rõ **giả định đầu vào khác nhau ở đâu** — nếu 3 kịch
bản chỉ khác nhau ở 1 con số cuối mà không nêu giả định gốc, đây là 3 con số
bịa ra dưới vỏ bọc "kịch bản", không phải phân tích thật.

## 2. Sensitivity analysis — biến nào ảnh hưởng nhiều nhất

Với mô hình tài chính có nhiều biến đầu vào (giá bán, CAC, churn rate, chi phí
vận hành...), xác định 2-3 biến có ảnh hưởng lớn nhất đến kết quả cuối (doanh
thu, lợi nhuận, thời gian hoà vốn) bằng cách thay đổi từng biến ±20% và quan
sát kết quả thay đổi bao nhiêu. Biến nào làm kết quả thay đổi mạnh nhất là
biến rủi ro cao nhất — đây chính là điều cần theo dõi sát nhất khi triển khai
thật, nêu rõ trong phần khuyến nghị.

Có dataset đủ lớn để chạy sensitivity/hồi quy chính quy → dùng
`statistical-analysis`. Chỉ có vài con số giả định (giai đoạn ý tưởng, chưa có
dữ liệu vận hành thật) → làm thủ công theo cách trên, ghi rõ đây là ước lượng
định tính có cấu trúc, không phải mô hình thống kê chính quy.

## 3. Khi nào cần dữ liệu/dùng skill khác

| Tình huống | Hành động |
|---|---|
| Có dataset lịch sử (doanh thu/user theo thời gian) và cần dự báo | Dùng `time-series-analysis` (đã có sẵn), trích kết luận vào báo cáo — không tự viết lại logic ARIMA/exponential smoothing ở đây |
| Cần so sánh 2 phương án (vd. 2 chiến lược giá) và có dữ liệu thử nghiệm | Dùng `statistical-analysis` cho hypothesis test đúng cách (t-test, chi-square...) |
| Chỉ có vài con số giả định, chưa có dataset | Dùng phương pháp best/base/worst + sensitivity thủ công ở mục 1-2 trên, không giả vờ đây là kết quả mô hình thống kê |
| Có số liệu tài chính cụ thể (doanh thu, CAC, churn...) | Chạy `scripts/kpi_calculator.py` (xem `SKILL.md`) thay vì tự tính nhẩm |

## 4. Kỷ luật ngôn từ

Áp dụng đúng nguyên tắc đã có ở skill `data-scientist`: dữ liệu quan sát chỉ
cho phép nói "có liên hệ với" (correlation), chỉ thí nghiệm ngẫu nhiên hoặc
thiết kế nhân quả được bảo vệ mới cho phép nói "gây ra" (causation). Một ước
lượng thị trường dựa trên số liệu thứ cấp từ `web_search` không bao giờ đủ căn
cứ để nói "chắc chắn sẽ", chỉ nên nói "theo số liệu hiện có, ước tính...".
