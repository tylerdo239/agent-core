# Bug thật: model leak cú pháp ChatML vào tool_call.name — 2026-08

## Triệu chứng ban đầu

User báo UI hiện lỗi xấu dạng:
```
web_search({"query":"thị trường viễn thông Việt Nam 2025 2026 quy mô","limit":10})]
</tool_call
IN {} OUT {"error":"tool \"web_search({...})]\n</tool_call\" not found","code":"TOOL_NOT_FOUND"}
```

Ban đầu tưởng chỉ là vấn đề hiển thị — điều tra sâu hơn phát hiện đây là **bug chức năng thật**: search bị bỏ lỡ hoàn toàn mỗi lần xảy ra, không chỉ là hiển thị xấu.

## Nguyên nhân gốc

Model (Qwen, qua `proxy.onebot.meobeo.ai`) đôi lúc rò rỉ cú pháp kiểu ChatML (`<tool_call>`/`<parameter>` — quy ước tool-calling dạng text của 1 số model khác) thẳng vào field `name` của cấu trúc `tool_calls[]` chuẩn OpenAI, thay vì dùng đúng field `arguments` riêng. Pattern quan sát được luôn nhất quán: `<tênThật>(<JSON args>)<đuôi rác>`.

Xác nhận bằng dữ liệu thật (không phải giả thuyết) — tra trực tiếp `sessions.db` production, thấy 3+ session khác nhau cùng pattern này, và model **luôn tự retry đúng ngay bước sau** với cùng query (loop-default không dừng vì lỗi tool — đúng thiết kế "tool failure là model-visible observation"), nhưng tốn oan 1 step + hiện lỗi kỹ thuật xấu ra UI cho lượt hỏng đó.

## Fix — 2 vòng, vòng 1 chưa đủ

Xem `bundles/providers/llm-qwen/index.ts` — hàm `repairToolCall()`, áp dụng ở cả `complete()` và `completeStream()`.

**Vòng 1** (giả thuyết ban đầu): gate sửa theo điều kiện `arguments` gốc **rỗng**. Deploy, test lại bằng script gọi live API nhiều lần ("hunt_bug.py") — **vẫn còn lỗi** (~1/9 lần).

**Vòng 2** (đào sâu bằng log tạm thời trên hệ thống đang chạy thật, không đoán): thêm log ghi mọi `name`/`arguments` delta, chạy tới khi bắt được đúng lúc lỗi xảy ra. Phát hiện: `arguments` không hẳn rỗng — đôi khi có **1 fragment rác lẻ** (ví dụ đúng 1 ký tự `"{"` từ 1 delta stream lạc), khiến `.trim()` vẫn coi là "có nội dung" và chặn nhầm không cho sửa. Sửa lại điều kiện đúng: `arguments` có **parse được thành JSON object hợp lệ** hay không (rỗng, thiếu, hay rác lẻ đều không parse được → cho phép thử sửa; chỉ khi `arguments` tự nó đã là JSON hợp lệ mới bỏ qua, không đè lên dữ liệu tốt model đã trả đúng field).

## Verify sau fix

Xoá log debug tạm, chạy lại 12 turn thật (`hunt_bug.py`, các prompt hay trigger nhiều `web_search` liên tiếp trong 1 turn — điều kiện dễ trigger bug nhất theo log production): **28/28 tool call sạch, 0 rác** — so với ~10% lỗi trước fix vòng 2. Test suite: 7 test mới trong `tests/llm-qwen-malformed-tool-call.test.ts` (cả 2 case thật từ log + case rác lẻ mới phát hiện), toàn bộ 315 test liên quan pass.

## Bài học

`.trim()` không phải phép thử đúng cho "field này có nội dung ý nghĩa hay không" khi dữ liệu tới từ streaming delta không tin cậy (fragment lạc, rác lẻ) — cần thử parse thật (`JSON.parse` + kiểm tra kiểu) mới biết chắc field có dùng được không.
