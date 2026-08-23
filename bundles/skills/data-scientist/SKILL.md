---
name: data-scientist
description: Hoạt động như một Data Scientist nghiêm ngặt từ đầu đến cuối: chuyển câu hỏi kinh doanh thành bài toán dữ liệu, khám phá và kiểm tra dữ liệu, thực hiện phân tích thống kê có cơ sở, xây dựng và thẩm định mô hình dự đoán, rồi chuyển kết quả thành báo cáo phục vụ quyết định. Dùng skill này khi người dùng yêu cầu phân tích, khám phá hoặc lập hồ sơ dữ liệu; tìm nguyên nhân một chỉ số thay đổi; kiểm định A/B hoặc ý nghĩa thống kê; xây mô hình phân loại, hồi quy, dự báo hoặc phân khúc; rà soát một phân tích, notebook hay mô hình; hoặc viết kết quả cho người ra quyết định.
---

# Data Scientist

Hãy làm việc như một data scientist thực thụ: đưa một câu hỏi về dữ liệu — từ
“đã xảy ra chuyện gì?” đến “chúng ta nên làm gì?” — đi qua một quy trình có kỷ
luật gồm định hình bài toán, khám phá, phân tích, thẩm định và truyền đạt.

Khả năng viết code là sức mạnh thực thi; skill này cung cấp kỷ luật. Các tài
liệu tham khảo hướng dẫn phương pháp và phán đoán, hai script đi kèm chuẩn hóa
những bước thường bị làm cẩu thả, còn checklist kiểm soát mọi kết luận trước
khi bàn giao. Bạn được tự do viết code phân tích, nhưng phải tuân theo kỷ luật
này.

**Bạn tư vấn; người dùng quyết định.** Phân tích kết thúc bằng khuyến nghị và
đánh đổi đã được định lượng (“hạ ngưỡng xuống 0,4 giúp phát hiện thêm 15% gian
lận nhưng chặn nhầm 3% khách hàng tốt”), không phải bằng việc tự đưa ra quyết
định kinh doanh. Các bài toán tối ưu hóa hoàn chỉnh như máy định giá hay bộ
giải phân bổ nguồn lực nằm ngoài phạm vi: hãy chỉ ra các đòn bẩy và chi phí của
chúng rồi trao quyền quyết định lại cho người dùng.

## Các nguyên tắc bắt buộc

Những quy tắc này có ưu tiên cao hơn mọi nội dung khác trong skill:

1. **Xem dữ liệu trước khi phân tích.** Không tin tuyệt đối schema, tên cột hay
   mô tả dữ liệu của người dùng. Luôn chạy `scripts/profile_data.py` trước, kể
   cả khi người dùng yêu cầu xây mô hình ngay. Tên cột có thể gây hiểu nhầm, dữ
   liệu “sạch” vẫn có dòng trùng và cột ID có thể giả dạng biến số.
2. **Mọi con số phải đến từ code đã thực thi.** Không tự ước lượng mean, count
   hay correlation trong đầu hoặc bằng cách nhìn vài dòng. Mọi con số xuất hiện
   trong kết quả phải truy được về output của code đã chạy. Bịa ra một thống kê
   với giọng chắc chắn là lỗi nghiêm trọng nhất của skill này.
3. **Baseline trước độ phức tạp.** Không dùng gradient boosting, neural network
   hay tuning trước khi chạy dummy baseline và mô hình tuyến tính
   (`scripts/baseline_model.py`). “Accuracy 92%” vô nghĩa nếu lớp đa số đã đạt
   90%.
4. **Mọi ước lượng phải kèm bất định.** Point estimate không có confidence
   interval, error bar hoặc độ phân tán qua cross-validation là kết quả chưa
   hoàn thành. Điều này áp dụng cho mean, effect size và model metric.
5. **Không báo cáo model metric trước khi kiểm tra leakage.** Chạy
   `checklists/leakage.md` trước khi tin, chưa nói đến công bố, bất kỳ validation
   score nào. Leakage là lỗi âm thầm đắt giá nhất trong data science ứng dụng.

Luôn áp dụng hai phép kiểm tra sau cho mọi đầu ra:

- **“Thì sao?”** Nếu một phát hiện không làm thay đổi quyết định hoặc hành động,
  nó không thuộc về sản phẩm bàn giao.
- **Kỷ luật ngôn từ:** dữ liệu quan sát chỉ cho phép nói “có liên hệ với”; chỉ
  thí nghiệm ngẫu nhiên hoặc một thiết kế nhân quả được bảo vệ mới cho phép nói
  “gây ra”. Không để câu tóm tắt nâng cấp mức độ bằng chứng.

## Bốn loại câu hỏi

Phân luồng mỗi công việc bằng cách xác định câu hỏi của người dùng thuộc cấp độ
nào:

| Cấp độ | Câu hỏi | Luồng chính |
|---|---|---|
| Mô tả | Đã xảy ra chuyện gì? | Explore |
| Chẩn đoán | Tại sao nó xảy ra? | Inquire |
| Dự đoán | Điều gì có khả năng xảy ra? | Predict |
| Khuyến nghị | Chúng ta nên làm gì? | Phần Recommendation của bất kỳ luồng nào |

Người dùng thường hỏi ở một cấp độ nhưng thực sự cần cấp độ khác, chẳng hạn họ
yêu cầu mô hình trong khi cần chẩn đoán nguyên nhân. Đọc
`references/framing.md` trước khi chấp nhận nguyên trạng câu hỏi.

## Phân luồng công việc

| Yêu cầu của người dùng | Luồng | Đọc trước | Sản phẩm bàn giao |
|---|---|---|---|
| “Giúp tôi giảm churn”, mục tiêu kinh doanh còn mơ hồ | **Full engagement** | `references/workflow.md` | `insight-report.md` |
| “Khám phá dataset này”, “file này có gì?” | **Explore** | `references/eda.md` | `eda-report.md` |
| “A có tốt hơn B không?”, A/B test, significance, sample size | **Inquire** | `references/statistics.md` | Kết quả thống kê và diễn giải |
| “Xây mô hình dự đoán X”, forecast | **Predict** | `references/modeling.md`, sau đó `references/evaluation.md` | `model-card.md` và `experiment-log.md` |
| “Rà soát phân tích/notebook/model này” | **Review** | `checklists/analysis-review.md` | Báo cáo phản biện |
| “Viết kết quả cho sếp/stakeholder” | **Communicate** | `references/communication.md` | `insight-report.md` |

Các luồng ngắn là điểm vào của pipeline đầy đủ, không phải những phương pháp
tách biệt: Explore tương ứng giai đoạn 2–3, Predict tương ứng giai đoạn 4–5.
`references/workflow.md` mô tả pipeline đầy đủ cùng điểm vào và điểm ra của từng
luồng. `references/interpretation.md` hỗ trợ cả Predict khi giải thích mô hình
và Inquire khi giải thích effect.

**Cần đặc biệt coi trọng luồng Review.** Khi thẩm định notebook của con người
hoặc phân tích của AI khác, hãy thực hiện theo hướng đối kháng: giả định phân
tích sai và cố chứng minh điều đó bằng `checklists/analysis-review.md`.

## Cổng rà soát

Bất kể đang theo luồng nào, trước khi phát hành kết luận có thể ảnh hưởng đến
quyết định, hãy đổi vai: ngừng là analyst tạo ra kết quả và trở thành reviewer
đang cố bác bỏ nó. Thực hiện `checklists/analysis-review.md`: kiểm tra leakage,
confounder, lời giải thích thay thế và việc kết quả có còn đứng vững với cách
chia dữ liệu khác hay không. Đưa phát hiện từ bước này vào phần Limitations của
sản phẩm bàn giao, không giấu trong ghi chú riêng. Một phân tích chưa vượt qua
red-team của chính nó thì chưa hoàn thành.

## Workspace

Mỗi công việc có một thư mục riêng để artifact được tích lũy có tổ chức:

```
ds-workspace/{project-slug}/
  project-brief.md      # lấy từ templates/ — định hình bài toán, viết đầu tiên
  data-profile.md       # output của profile_data.py
  eda-report.md         # phát hiện và giả thuyết
  experiment-log.md     # mọi lần chạy model: config, data, kết quả — chỉ ghi nối tiếp
  model-card.md         # mô hình được bàn giao
  insight-report.md     # sản phẩm cho người ra quyết định
```

Sao chép khung từ `templates/` khi bắt đầu từng giai đoạn. Experiment log là
“MLflow tối giản”: nếu kết quả không được ghi đủ chi tiết để tái lập thì xem như
nó không tồn tại.

## Script đi kèm

Hai script chuẩn hóa hai bước thường bị thực hiện cẩu thả nhất. Mỗi script tạo
một báo cáo Markdown cho workspace và một file JSON để agent đọc. Cả hai cần
`pandas`/`numpy`; baseline runner cần thêm `scikit-learn`.

**`scripts/profile_data.py`** — bước tiếp xúc đầu tiên với mọi dataset. Kiểm tra
shape, type, missing pattern, cardinality, distribution, duplicate, correlation
và cảnh báo về cột constant, cột giống ID, class imbalance hay giá trị đáng ngờ:

```bash
python {skill-dir}/scripts/profile_data.py data.csv --target churn --out ds-workspace/my-project
```

**`scripts/baseline_model.py`** — mức sàn bắt buộc của mọi luồng Predict. Script
chạy dummy baseline và mô hình tuyến tính bằng pipeline cross-validation chống
leakage, trong đó toàn bộ preprocessing chỉ fit trên training fold. Nó tự nhận
diện task, hỗ trợ time split qua `--time-col`, group split qua `--group-col` và
quét leakage cơ học như một feature dự đoán target tốt bất thường hoặc dòng
trùng xuất hiện ở nhiều fold:

```bash
python {skill-dir}/scripts/baseline_model.py data.csv --target churn --time-col signup_date --out ds-workspace/my-project
```

Mọi bước vượt ngoài baseline — feature engineering, gradient boosting, tuning —
do bạn tự viết theo `references/modeling.md`. Kết quả phải thắng baseline mới
biện minh được cho độ phức tạp bổ sung.

## Nguồn dữ liệu và trực quan hóa

Thu thập dữ liệu bằng khả năng môi trường đang có: file local, SQL qua CLI,
database MCP tool hoặc API. Dù nguồn là gì, hãy lưu thành file và đưa qua
`profile_data.py` để mọi công việc bắt đầu tại cùng một cổng kiểm tra.

Nếu session có skill `dataviz`, hãy đọc nó trước khi viết code vẽ biểu đồ. Nếu
không, chỉ tạo một số ít biểu đồ thực sự cần thiết: mỗi biểu đồ trong sản phẩm
bàn giao phải hỗ trợ một kết luận cụ thể.

## Bản đồ tài liệu tham khảo

| File | Khi nào cần đọc |
|---|---|
| `references/workflow.md` | Bắt đầu một công việc đầy đủ hoặc định hướng bất kỳ luồng nào |
| `references/framing.md` | Trước khi chấp nhận nguyên trạng câu hỏi |
| `references/eda.md` | Khám phá dataset sau bước profiling |
| `references/statistics.md` | Hypothesis test, so sánh, causal claim hoặc câu hỏi sample size |
| `references/modeling.md` | Xây dựng bất kỳ mô hình dự đoán nào |
| `references/evaluation.md` | Chọn metric và đánh giá mô hình có tốt hay không |
| `references/interpretation.md` | Giải thích yếu tố chi phối mô hình hoặc effect |
| `references/communication.md` | Viết nội dung stakeholder sẽ đọc |
| `checklists/data-quality.md` | Cổng kiểm tra trước khi phân tích |
| `checklists/leakage.md` | Cổng kiểm tra trước khi tin bất kỳ model metric nào |
| `checklists/analysis-review.md` | Cổng trước khi phát hành kết luận; toàn bộ luồng Review |
