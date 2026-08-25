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
//
// Follow-up (2026-08) — deploy VPS domain riêng: giả định "REST/WS sống
// CÙNG hostname với web app, chỉ khác port" ở trên KHÔNG còn đúng khi app
// (vd. app-harness.onebot.meobeo.ai) và API (vd. api-harness.onebot.meobeo.ai)
// là 2 SUBDOMAIN khác nhau hoàn toàn (không chỉ khác port). `location.
// hostname` lúc đó sẽ luôn là domain của APP, không phải domain của API —
// không có cách nào suy ra domain API chỉ từ `location`. Thêm 2 biến build-
// time `VITE_REST_URL`/`VITE_WS_URL` (Vite tự inject `import.meta.env.VITE_*`
// lúc `npm run build:web`, xem Dockerfile stage `build-web` + docker-
// compose.yml `agent-core.build.args`) — có set thì DÙNG THẲNG, không set
// (mặc định, đúng hành vi cũ) thì rơi về suy luận từ `location.hostname` như
// trước (deployment 1-host, backward compatible 100%).
export interface Settings {
  restUrl: string
  wsUrl: string
}

export function defaultSettings(): Settings {
  const envRestUrl = import.meta.env.VITE_REST_URL
  const envWsUrl = import.meta.env.VITE_WS_URL
  if (envRestUrl && envWsUrl) {
    return { restUrl: envRestUrl, wsUrl: envWsUrl }
  }
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
