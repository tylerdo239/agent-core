// packages/ui-slots/src/index.ts — Phase 9.6: entry point duy nhất cho
// `@agent-core/ui-slots` sau khi có npm workspaces — gộp core (9.1) + seam
// Cordis (9.2) + hợp đồng tool-view (9.4). Trước 9.6, các package khác import
// trực tiếp từng file con qua relative path (`../../ui-slots/src/core.ts`...)
// vì bare specifier chưa resolve được — giờ có workspaces, đổi lại qua đây.
export * from './core.ts'
export * from './seam.ts'
export * from './tool-view.ts'
