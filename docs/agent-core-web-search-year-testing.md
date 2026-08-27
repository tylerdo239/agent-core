# Test thật: model dùng sai năm khi search — 2026-08

## Bối cảnh

User báo triệu chứng: hỏi "báo cáo doanh nghiệp FPT" nhiều lần, có lúc model search năm 2026 (đúng, năm hiện tại), có lúc search năm 2025 (lệch 1 năm). Trước khi sửa `src/environment-note.ts`, đã chạy test thật (không phải giả thuyết) để xác nhận bug có thật và đo đúng phạm vi.

## Phương pháp

Chạy 8 câu hỏi tiếng Việt/Anh thật về FPT (không chỉ định năm, đúng kiểu user hay hỏi), mỗi câu lặp lại 2 lần (16 turn thật tổng cộng), qua REST API của chính service đang chạy (`POST /sessions` → `POST /sessions/:id/messages` → `GET /sessions/:id/events`), trích ra `args.query` của mọi lần model gọi tool `web_search`. Ngày server lúc test: `2026-08-27`.

## Kết quả thô

| Câu hỏi | Lần 1 | Lần 2 |
|---|---|---|
| "Cho tôi báo cáo doanh nghiệp FPT gần đây" | `FPT Corporation financial report 2025 2026 quarterly results revenue` | `FPT Corporation financial report 2025 2026 recent` |
| "Phân tích tình hình kinh doanh của FPT hiện tại" | 5 query, đa số có 2026 | 3 query, đa số có 2026 |
| **"Tìm báo cáo tài chính mới nhất của FPT"** | `FPT latest financial report 2024 2025` **← thiếu 2026** | `FPT financial report 2024 2025 latest annual report` **← thiếu 2026** |
| "FPT năm nay kinh doanh thế nào" | `FPT năm 2026 ...` (đúng) | `... năm 2026` (đúng) |
| **"So sánh doanh thu FPT năm nay với năm ngoái"** | `FPT revenue 2025 vs 2024` **← lệch 1 năm** | `FPT revenue 2025 vs 2024` **← lệch 1 năm, y hệt lần 1** |
| "Kết quả kinh doanh quý gần nhất của FPT" | có 2025+2026 | có 2024+2025+2026 |
| "Tóm tắt báo cáo thường niên FPT" | `2025 2024` (hợp lý — báo cáo 2026 chưa tồn tại vì năm chưa hết) | tương tự |
| "Search tin tức mới nhất về FPT Corporation" | `... 2026` (đúng) | `... 2026` (đúng) |

Tổng: 22 query trích được, 16 chứa đúng năm 2026, 6 chứa 2025 mà không có 2026 — nhưng KHÔNG rải ngẫu nhiên: toàn bộ 6 trường hợp lệch dồn vào đúng 2 câu hỏi ("mới nhất", "năm nay ... năm ngoái"), và LẶP LẠI Y HỆT ở cả 2 lần thử mỗi câu — xác nhận đây là lệch có hệ thống theo cách diễn đạt, không phải nhiễu do sampling.

## Nguyên nhân

`environmentNote()` (bản trước sửa) chỉ cho model 1 chuỗi ISO date + câu hướng dẫn chung chỉ liệt kê "current"/"latest"/"hôm nay" — model phải **tự parse** chuỗi ISO ra năm, và danh sách từ khoá không phủ đúng các cụm tiếng Việt gây lỗi thật ("mới nhất", "năm nay", "năm ngoái", "gần đây").

## Fix

Xem `src/environment-note.ts` — tính sẵn `currentYear`/`lastYear` thành số nguyên (bỏ bước model tự suy), mở rộng danh sách cụm từ khớp đúng các trường hợp đã fail, thêm 1 câu chỉ dẫn hành động cụ thể cho việc dựng search query.

## Xác nhận lại sau fix

Chạy lại đúng 2 câu hỏi từng fail ("Tìm báo cáo tài chính mới nhất của FPT", "So sánh doanh thu FPT năm nay với năm ngoái"), mỗi câu N lần — xem `test_year_after_fix.py`/log tương ứng lúc verify.
