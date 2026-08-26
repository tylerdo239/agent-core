// @vitest-environment jsdom
//
// Follow-up (2026-08) — deploy VPS domain riêng: defaultSettings() giờ ưu
// tiên VITE_REST_URL/VITE_WS_URL (build-time, xem ghi chú ở settings.ts) khi
// app và API sống trên 2 SUBDOMAIN khác nhau (location.hostname không suy ra
// được domain API trong trường hợp đó) — verify cả 2 nhánh: có set (dùng
// thẳng) và không set (rơi về suy luận từ location.hostname như cũ, không
// đổi hành vi deployment 1-host hiện tại).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../src/settings.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('defaultSettings', () => {
  it('KHÔNG set VITE_REST_URL/VITE_WS_URL -> suy luận từ location.hostname (hành vi cũ, 1-host)', () => {
    expect(defaultSettings()).toEqual({
      restUrl: `${location.protocol}//${location.hostname}:8787`,
      // Phase 6.3: wsUrl suy từ restUrl (cùng port 8787, api-ws/8788 đã gộp vào api-rest).
      wsUrl: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:8787`,
    })
  })

  it('có set VITE_REST_URL/VITE_WS_URL -> DÙNG THẲNG (deploy 2 subdomain khác nhau, vd. app-harness/api-harness)', () => {
    vi.stubEnv('VITE_REST_URL', 'https://api-harness.onebot.meobeo.ai:4098')
    vi.stubEnv('VITE_WS_URL', 'wss://api-harness.onebot.meobeo.ai:4098')

    expect(defaultSettings()).toEqual({
      restUrl: 'https://api-harness.onebot.meobeo.ai:4098',
      wsUrl: 'wss://api-harness.onebot.meobeo.ai:4098',
    })
  })

  it('chỉ set 1 trong 2 biến -> vẫn rơi về suy luận từ location.hostname (tránh cấu hình nửa vời)', () => {
    vi.stubEnv('VITE_REST_URL', 'https://api-harness.onebot.meobeo.ai:4098')

    expect(defaultSettings()).toEqual({
      restUrl: `${location.protocol}//${location.hostname}:8787`,
      // Phase 6.3: wsUrl suy từ restUrl (cùng port 8787, api-ws/8788 đã gộp vào api-rest).
      wsUrl: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:8787`,
    })
  })
})
