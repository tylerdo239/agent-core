// packages/ui-settings-general/src/settings.ts — Phase 9.4: port nguyên
// logic settings từ bundles/adapters/web-ui/public/app.js (Phase 7), không
// đổi hành vi. Chuyển vào package riêng ở phase restructure UI mirror dsh
// (packages/client/ui-settings-general) — vẫn nguyên logic, chỉ đổi vị trí.
//
// Module auth (nhiều người dùng thật): `apiKey` đã bị XOÁ khỏi Settings —
// danh tính giờ là tài khoản thật (username/password -> token), sống ở
// packages/ui-auth/src/authState.ts (localStorage key riêng), không còn
// trộn chung với cấu hình URL kết nối ở đây nữa.
//
// Follow-up (2026-08): nút "Cấu hình" (restUrl/wsUrl, form sửa tay) bị THAY
// THẾ HOÀN TOÀN bởi "Cấu hình plugin" (packages/ui-plugin-settings, lưu
// Postgres) — deployment thật của user luôn trỏ 1 server cố định, không cần
// đổi restUrl/wsUrl qua UI nữa. `loadSettings()` trước đây merge localStorage
// đè lên default — vì `saveSettings()` không còn ai gọi (đường ghi đã mất
// từ lúc bỏ SettingsForm), giữ nguyên đường ĐỌC localStorage sẽ là 1 bẫy
// thật: browser nào đã từng lưu giá trị tuỳ chỉnh qua form CŨ (trước follow-
// up này) sẽ mãi mãi thấy giá trị cũ đó thay vì default mới, không có cách
// nào qua UI để nhận ra hay sửa lại. Bỏ hẳn đường đọc — luôn dùng đúng
// default tính theo `location.hostname` (khớp deployment Docker Compose
// thật), giá trị localStorage cũ (nếu có) trở thành dữ liệu mồ côi vô hại,
// không cần dọn chủ động.
export interface Settings {
  restUrl: string
  wsUrl: string
}

export function defaultSettings(): Settings {
  const proto = location.protocol === 'https:' ? 'https:' : 'http:'
  const wsProto = proto === 'https:' ? 'wss:' : 'ws:'
  return {
    restUrl: `${proto}//${location.hostname}:8787`,
    wsUrl: `${wsProto}//${location.hostname}:8788`,
  }
}

export function loadSettings(): Settings {
  return defaultSettings()
}
