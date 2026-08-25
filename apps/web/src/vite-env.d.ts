// apps/web/src/vite-env.d.ts — chuẩn scaffold Vite, cho `import.meta.env`
// (bao gồm `VITE_*` inject lúc build) có type thay vì lỗi "Property 'env'
// does not exist on type 'ImportMeta'" (tsconfig gốc chỉ khai `types:
// ["node"]`, không tự có ambient này). Global augmentation — chỉ cần khai 1
// lần ở ĐÂU ĐÓ nằm trong `include` của tsconfig gốc (packages/ui-settings-
// general cũng dùng import.meta.env.VITE_REST_URL/VITE_WS_URL, không cần
// khai lại riêng).
/// <reference types="vite/client" />
