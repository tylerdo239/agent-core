// apps/web/vite.config.ts — Phase 9.4. `root` tính tuyệt đối qua
// `import.meta.url` (không dựa vào cwd) — script `dev:web` ở package.json
// gốc (agent-core/) chạy `vite --config apps/web/vite.config.ts` từ cwd
// agent-core/, không phải từ apps/web/.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
  },
})
