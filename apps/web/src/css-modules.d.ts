// apps/web/src/css-modules.d.ts — Phase 10.3: ambient type cho `*.module.css`
// (CSS Modules) — không có sẵn trong TS core, cần khai tường minh để `tsc`
// hiểu `import styles from './X.module.css'` trả về object map className.
// Cùng tên file dsh thật dùng (packages/client/*/css-modules.d.ts).
declare module '*.module.css' {
  const classes: { readonly [className: string]: string }
  export default classes
}
