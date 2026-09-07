/**
 * Số phiên bản của toàn bộ ứng dụng — TĂNG TAY mỗi lần deploy một thay đổi
 * đáng kể.
 *
 * Vì sao cần: giao diện web là một bundle build RIÊNG (apps/web/dist), không
 * tự mới theo backend. Kịch bản hay gặp: sửa code → deploy backend → QUÊN
 * build lại web → trình duyệt vẫn chạy bundle cũ mà nhìn bên ngoài không có
 * dấu hiệu gì. Nếu con số này do backend cấp cho web hiển thị thì đúng lỗi
 * đó bị che mất, vì backend luôn trả số mới.
 *
 * Cách dùng đúng: web import THẲNG hằng số này (nên nó bị nướng vào bundle
 * lúc build) và ĐỒNG THỜI đọc số backend trả về qua GET /health, rồi hiện
 * cả hai cạnh nhau. Lệch nhau là biết ngay phía nào cũ:
 *
 *     ui 3 · api 3   -> khớp
 *     ui 2 · api 3   -> bundle web cũ, chưa build lại
 *     ui 3 · api 2   -> backend cũ, container chưa restart
 *
 * File này CỐ Ý không import gì cả: nhờ vậy frontend import được mà không
 * kéo theo code backend vào bundle. Giữ nguyên như thế.
 *
 * Một hằng số cho cả hai phía, không phải hai bản sao — hai bản sao thì sớm
 * muộn lệch nhau và con số mất hết ý nghĩa.
 */
export const APP_VERSION = 1
