# Test live 20 kịch bản: skill có thực sự đọc resource? — 2026-08

## Mục tiêu

Kiểm chứng bằng dữ liệu thật (không phải đọc code suy đoán): sau khi 1 skill
được load (qua trigger, chọn tường minh, hay router semantic vừa transfer từ
loop-rlm sang loop-default), model có thực sự gọi `read_skill_resource` để
đọc các file `references/*.md`/`templates/*`/`assets/*` mà SKILL.md của nó
chỉ định hay không — hay chỉ dừng ở việc nạp `instructions` rồi bịa.

## Vòng 1 — 20 prompt ngắn, đa dạng skill, `maxSteps` mặc định

Script: REST API thật (`/auth/signup` → `/sessions` → `/sessions/:id/messages`
→ `/sessions/:id/events`), 20 prompt trải đều `business-case-builder`,
`cohort-analysis`, `data-quality-audit`, `funnel-analysis`,
`segmentation-analysis`, `time-series-analysis`.

Kết quả thô: 18/20 đúng skill kỳ vọng, **1/20 có đọc resource**, 0 leaked
`[tool_call:...]` label, 0 lỗi.

Điều tra 1/20 bằng cách đọc trực tiếp `sessions.db` production: đa số session
dừng sau ĐÚNG 1 lượt model — vì prompt test cố tình mơ hồ (không nêu công
ty/ngành/quy mô cụ thể), và các skill này có luật riêng "câu hỏi mơ hồ → hỏi
lại phạm vi trước khi search" (đúng thiết kế, không phải bug). Script chỉ gửi
1 lượt/session nên không bao giờ có cơ hội trả lời câu hỏi làm rõ đó — hạn chế
của cách test, không phải hạn chế của hệ thống.

## Vòng 2 — 6 prompt đủ chi tiết (tránh bị chặn ở câu hỏi làm rõ), `maxSteps: 15`

Kết quả: 6/6 đúng skill, **5/6 có đọc resource**, 0 leaked, nhưng **1/6 lỗi
`NO_PROGRESS: exceeded maxSteps`**.

Theo dõi chi tiết session lỗi (mở rộng chuỗi cà phê TP.HCM→Hà Nội): model làm
ĐÚNG và ĐẦY ĐỦ quy trình skill yêu cầu — 6 lượt `web_search` khác góc độ, 7
lượt `read_skill_resource` (kể cả tự phục hồi đúng sau khi context bị nén,
đọc lại resource cần thiết) — nhưng cạn hết 15 bước trước khi kịp viết báo
cáo cuối, turn bị hủy giữa chừng.

## Phát hiện chính: `maxSteps` mặc định (8) quá thấp cho production thật

`Session.maxSteps` mặc định = 8 (`seams/loop.ts`), và **UI thật (web + REST
`/sessions` không kèm `maxSteps` trong body) không bao giờ override giá trị
này** — nghĩa là MỌI session thật trong production đang chạy với ngân sách 8
bước.

Trong khi đó, SKILL.md của `business-case-builder` (và tương tự với các skill
data-science khác có nhiều `references/`) tự quy định quy trình nhiều bước:
tối thiểu 2-3 lượt `web_search` (Nguyên tắc bắt buộc #7) + đọc 3-5 file
reference (Quy trình 5 bước) + template + checklist trước khi bàn giao. Với
default 8 bước, gần như CHẮC CHẮN bị `NO_PROGRESS` cắt ngang mọi yêu cầu
business-case đầy đủ — đúng lúc skill đang làm việc nghiêm túc nhất (tìm dữ
liệu thật, đọc tài liệu chuyên môn), người dùng nhận về lỗi kỹ thuật thay vì
báo cáo.

## Fix

Nâng `Session.maxSteps` mặc định từ 8 lên **25** (`seams/loop.ts`) — có dư
margin so với case đã đo được thực tế (chạy hết 15 bước vẫn còn việc dở: chưa
viết báo cáo cuối, chưa chạy checklist). Cập nhật 2 test khẳng định giá trị
mặc định cũ (`tests/api-grpc.test.ts`, `tests/api-rest.test.ts`).

## Kết luận cho câu hỏi gốc "skill có dùng resource không"

**Có** — khi có đủ ngân sách bước và task đủ cụ thể để không bị chặn ở câu hỏi
làm rõ phạm vi, model tuân thủ đúng quy trình đọc resource mà skill quy định
(5/6 ở vòng 2, đọc đúng thứ tự, đúng file, kể cả sau khi context bị nén). Vấn
đề thật không nằm ở việc model "lười" đọc tài liệu, mà ở ngân sách bước mặc
định quá hẹp so với chính yêu cầu do skill tự đặt ra.
