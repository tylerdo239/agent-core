# Bug thật: composer khoá cứng sau khi turn xong, không chat tiếp được — 2026-08

## Triệu chứng ban đầu

User báo trực tiếp: "khi tôi hỏi và nó report ra báo cáo xong rồi, thì không
có khả năng chat tiếp theo".

## Điều tra

Tra trực tiếp `sessions.db` production: đúng 1 session thật khớp mô tả —
model trả lời xong 1 báo cáo hoàn chỉnh (turn thành công, không có event
`error` nào), nhưng sau đó **không có `user_message` nào tiếp theo trong
chính session đó** — nghĩa là lượt chat kế tiếp của user chưa bao giờ chạm
tới backend (không có log lỗi server-side quanh mốc thời gian đó). Kết luận:
lỗi nằm ở frontend, không phải backend.

## Nguyên nhân gốc — deadlock 2 nửa trong `apps/web/src/App.tsx`

1. `composerEnabled = status === 'connected' && !turnInFlight` — input/nút
   gửi bị khoá bất cứ khi nào `status !== 'connected'`.
2. `status` chuyển sang `'disconnected'` khi WebSocket đóng bất ngờ (idle
   timeout qua proxy/nginx, network blip) — sự kiện hoàn toàn có thể xảy ra
   sau 1 turn dài (nhiều lượt `web_search`/đọc skill resource).
3. Cơ chế DUY NHẤT có thể tự mở lại WebSocket là `ensureStream()`, và nó chỉ
   được gọi từ BÊN TRONG `sendUserMessage()`.
4. Nhưng `sendUserMessage()` tự nó cũng có guard `status !== 'connected' ->
   return false`, VÀ composer đã bị khoá ở bước 1 nên người dùng không thể
   bấm gửi để kích hoạt hàm này nữa.

Kết quả: WS rớt → status 'disconnected' → composer khoá cứng → hàm duy nhất
có thể tự phục hồi kết nối không bao giờ được gọi lại → deadlock vĩnh viễn,
chỉ còn cách reload toàn bộ trang. Không có banner/toast nào giải thích lý do
cho user — từ góc nhìn người dùng, app trông như bị treo hoàn toàn không rõ
nguyên nhân.

## Fix

`apps/web/src/App.tsx`:
- `composerEnabled`: bỏ điều kiện `status === 'connected'`, chỉ còn
  `!turnInFlight` — composer luôn cho phép gõ/gửi.
- `sendUserMessage()`: bỏ cùng điều kiện khỏi guard đầu hàm — luôn cho thử
  gửi, để `ensureStream()` bên trong tự mở lại WS nếu cần. Thất bại thật
  (server chết hẳn, mất mạng) vẫn được xử lý đúng qua `catch` +
  `pushToast('Gửi tin nhắn thất bại: ...')` sẵn có.
- Thêm `pushToast('Mất kết nối tới máy chủ — gửi tin nhắn tiếp theo sẽ tự kết
  nối lại.', 'error')` ngay trong handler `close` của WS, chỉ khi socket vừa
  đóng THẬT SỰ là socket đang hoạt động (`settled && wsRef.current === ws`,
  loại trừ trường hợp đổi session/mở WS mới đã có sẵn) — để user hiểu ngay lý
  do gián đoạn thay vì đoán mò.

Không đổi hành vi "không tự động reconnect ngầm" đã có từ trước (quyết định
thiết kế cũ, xem comment gốc ở `ensureStream()`) — chỉ gỡ đúng chỗ khoá lối
thoát của cơ chế reconnect-khi-gửi vốn đã tồn tại sẵn nhưng không bao giờ tới
lượt chạy.

## Verify

Test mới `apps/web/tests/App.smoke.test.tsx` — mô phỏng đúng chuỗi sự kiện:
gửi 1 tin nhắn → nhận `final`/`done` → WS đóng bất ngờ (`socket.close()`,
không phải do App tự đóng để đổi session) → verify composer KHÔNG bị khoá →
gửi tiếp thành công, tự mở 1 WebSocket mới. Xác nhận test bắt đúng bug bằng
cách tạm revert fix — test FAIL đúng như kỳ vọng (`textarea.disabled` = true)
trước fix, PASS sau fix. Full suite: 330 pass (tăng 1) / 41 fail cũ không
liên quan (thiếu Postgres cục bộ), typecheck sạch.
