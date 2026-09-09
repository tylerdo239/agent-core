import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Stage `build-web` trong Dockerfile chỉ copy một tập thư mục chọn lọc, nên một
// import trỏ ra ngoài apps/web + packages sẽ build được ở local (dev overlay
// mount cả repo) nhưng chết ở `docker compose up --build`. Test này bắt lệch đó.
describe('Dockerfile build-web stage', () => {
  it('copies every file apps/web imports from outside its own tree', () => {
    const dockerfile = readFileSync('Dockerfile', 'utf8')
    const stage = dockerfile
      .slice(dockerfile.indexOf('AS build-web'), dockerfile.indexOf('AS runtime'))
      .split('\n')
      .filter((line) => line.startsWith('COPY '))
      .join('\n')
    const app = readFileSync('apps/web/src/App.tsx', 'utf8')
    for (const [, spec] of app.matchAll(/from '((?:\.\.\/)+[^']+)'/g)) {
      const resolved = spec.replace(/^(\.\.\/)+/, '')
      if (resolved.startsWith('packages/')) continue
      expect(stage, `Dockerfile build-web thiếu COPY cho ${resolved}`).toContain(resolved)
    }
  })
})
