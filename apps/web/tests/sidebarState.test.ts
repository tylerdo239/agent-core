// @vitest-environment jsdom
//
// Verify THẬT localStorage CRUD cho trạng thái thu gọn sidebar (Phase 14).
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSidebarCollapsed, saveSidebarCollapsed } from '../src/sidebarState.ts'

beforeEach(() => {
  localStorage.clear()
})

describe('sidebarState', () => {
  it('loadSidebarCollapsed() trên localStorage rỗng -> false (mặc định mở rộng)', () => {
    expect(loadSidebarCollapsed()).toBe(false)
  })

  it('saveSidebarCollapsed(true) rồi load lại -> true', () => {
    saveSidebarCollapsed(true)
    expect(loadSidebarCollapsed()).toBe(true)
  })

  it('saveSidebarCollapsed(false) rồi load lại -> false', () => {
    saveSidebarCollapsed(true)
    saveSidebarCollapsed(false)
    expect(loadSidebarCollapsed()).toBe(false)
  })
})
