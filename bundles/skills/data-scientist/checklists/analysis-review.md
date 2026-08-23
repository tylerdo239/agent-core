# Cổng rà soát phân tích (Red-Team)

Đây là lượt kiểm tra đối kháng: giả định phân tích sai và cố chứng minh điều đó.
Áp dụng cho công việc của chính bạn trước khi phát hành kết luận (Giai đoạn 6),
hoặc làm toàn bộ luồng Review khi phản biện phân tích, notebook hay mô hình của
người khác, kể cả nội dung do AI tạo.

Thực hiện theo thứ tự vì phát hiện sớm sẽ ít tốn kém hơn. Mọi phát hiện phải
được xác minh bằng code trước khi báo cáo. Xếp hạng phát hiện là **nghiêm trọng**
(kết luận đảo ngược hoặc biến mất), **đáng kể** (quy mô/độ tin cậy thay đổi đủ
để ảnh hưởng quyết định), hoặc **nhỏ**.

## 1. Phép tính có đúng không?

- [ ] Truy ngược hai hoặc ba con số quan trọng nhất về code đã thực thi. Với
      công việc của người khác, tính lại độc lập; đặc biệt kiểm tra join làm
      nhân bản dòng và denominator đã bị lọc.
- [ ] Kiểm tra denominator: rate = số sự kiện / *quần thể nào*? Thay denominator
      giữa các nhóm so sánh có thể tạo ra xu hướng giả.
- [ ] Grain khi aggregate có nhất quán không? Có đang lấy trung bình của các
      trung bình, và đã dùng trọng số khi cần chưa?

## 2. Dữ liệu có thể tạo ra kết quả này khi hiệu ứng được tuyên bố không tồn tại?

- [ ] **Selection effect:** ai vắng mặt trong dữ liệu, và họ có vắng mặt *do*
      outcome không? Ví dụ survivorship khi chỉ phân tích khách hàng hiện tại,
      hoặc collider khi chỉ phân tích người đã chuyển đổi.
- [ ] **Artifact dữ liệu bị hiểu thành phát hiện:** system migration, field chỉ
      được điền từ một thời điểm, kỳ gần nhất chưa đầy đủ hoặc định nghĩa thay
      đổi giữa lịch sử đều có thể giả dạng hiệu ứng thật.
- [ ] **Regression to the mean:** đối tượng được chọn vì giá trị cực đoan có thể
      tự quay về mức trung bình dù không có can thiệp. Mọi so sánh before/after
      trên nhóm được chọn vì cực đoan đều đáng ngờ.
- [ ] **Seasonality/mix confound:** “hiệu ứng” có thực ra là yếu tố lịch hoặc sự
      thay đổi thành phần, chẳng hạn quý này có nhiều segment A hơn không?

## 3. Kết quả thống kê có đứng vững không?

- [ ] **Kiểm tra Simpson:** quan hệ chính có còn đúng trong từng segment lớn,
      hay đảo chiều khi tách nhóm?
- [ ] **Multiple comparisons:** đã xem bao nhiêu test, segment và metric để tìm
      ra kết quả này? Hai mươi lần thử thường đủ tạo một phát hiện giả. Garden
      of forking paths vẫn được tính dù không thực hiện test chính thức.
- [ ] **Effect size và significance:** effect có đủ lớn để hành động hay chỉ
      khác 0 vì n lớn? Ngược lại, “không có effect” có thực ra là CI quá rộng
      nên chưa học được gì không?
- [ ] **Giả định:** đặc biệt là independence. Xem quan sát lặp/clustered như độc
      lập sẽ thổi phồng độ tin cậy; xem `references/statistics.md`.
- [ ] **Peeking:** với experiment, stopping rule có được cố định trước không?

## 4. Ngôn ngữ nhân quả có phù hợp bằng chứng không?

- [ ] Tìm “gây ra / thúc đẩy / dẫn đến / bởi vì / tác động”. Mỗi cách diễn đạt
      phải được bằng chứng cho phép theo thang bằng chứng trong tài liệu
      statistics; nếu không, đổi thành “có liên hệ với”.
- [ ] Với mỗi driver được tuyên bố, nêu một confounder hợp lý. Nếu tồn tại mà
      chưa được xử lý, phải hạ mức kết luận.
- [ ] Executive summary phải dùng mức ngôn ngữ nhân quả *yếu nhất* trong chuỗi
      bằng chứng, không phải mức mạnh nhất.
- [ ] Có đang trình bày model importance như một đòn bẩy không? Importance
      không đồng nghĩa causality; xem `references/interpretation.md`.

## 5. Với mô hình: score có thật và phù hợp không?

- [ ] Đã chạy `checklists/leakage.md` cùng các probe, không chỉ tick checkbox.
- [ ] Validation phản ánh deployment: cách split phù hợp cách prediction được
      sử dụng theo thời gian và entity.
- [ ] Thắng dummy và linear baseline nhiều hơn độ phân tán CV.
- [ ] Có bao nhiêu experiment trước kết quả này? Score tốt nhất trong 50 lần CV
      bị optimistic bias; holdout có chỉ được dùng một lần không?
- [ ] Đã xem metric theo lát cắt: giai đoạn gần đây, segment chính và nhóm tập
      trung thiệt hại.

## 6. Robustness — kết luận có sống sót khi bị thử thách không?

Chọn hai phép thử đe dọa kết luận nhất và chạy chúng:

- [ ] Split/seed/time window khác → cùng kết luận?
- [ ] Loại hoặc giữ outlier → cùng kết luận?
- [ ] Định nghĩa hợp lý khác của target, segment hoặc metric → cùng kết luận?
- [ ] Placebo test khi phù hợp: “effect” có xuất hiện ở nơi logic nói rằng nó
      không thể xuất hiện, như pre-period hay nhóm không chịu tác động? Nếu có,
      phương pháp đang tự sản xuất effect.

## 7. Đóng gói trung thực

- [ ] Mọi estimate được báo cáo đều kèm uncertainty.
- [ ] Phần Limitations cụ thể và chứa các lo ngại còn lại từ checklist này.
- [ ] Chart không phóng đại: không cắt trục để thổi phồng, không ám chỉ bằng hai
      trục, và thể hiện range khi tồn tại.
- [ ] Qua phép thử “thì sao?”: kết luận nối được với quyết định trong brief.

## Phán quyết

Với công việc của mình: sửa phát hiện nghiêm trọng và đáng kể bằng cách quay lại
Giai đoạn 4/5; đưa nguyên văn lo ngại còn lại vào Limitations. Với luồng Review:
bàn giao các phát hiện theo thứ tự nghiêm trọng → đáng kể → nhỏ, mỗi phát hiện
kèm code chứng minh và cách sửa cụ thể, theo cấu trúc critique trong
`references/communication.md`.
