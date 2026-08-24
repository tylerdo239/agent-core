// @vitest-environment jsdom
//
// PluginInventoryPanel bọc Modal (<dialog> thật) -- cùng giới hạn môi trường
// test đã gặp khắp nơi trong repo: jsdom không implement showModal()/close().
// Cùng pattern packages/ui-auth/tests/AdminUsersPanel.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PluginInventoryPanel } from '../src/PluginInventoryPanel.tsx'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const plugins = [
  { name: 'tool-registry', category: 'provider', state: 'active' },
  { name: 'sandbox-docker', category: 'provider', state: 'failed' },
  { name: 'loop-rlm', category: 'loop-driver', state: 'pending' },
]

describe('PluginInventoryPanel', () => {
  it('mở panel -> gọi GET /plugins, render đúng danh sách + trạng thái', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ plugins }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginInventoryPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })

    await waitFor(() => expect(screen.getByText('tool-registry')).toBeTruthy())
    expect(screen.getByText('sandbox-docker')).toBeTruthy()
    expect(screen.getByText('loop-rlm')).toBeTruthy()
    expect(screen.getByText('hoạt động')).toBeTruthy()
    expect(screen.getByText('lỗi')).toBeTruthy()
    expect(screen.getByText('đang chờ')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/plugins', { headers: { authorization: 'Bearer tok' } })
  })

  it('gõ ô tìm kiếm -> lọc đúng theo tên/nhóm, không gọi lại fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ plugins }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginInventoryPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })
    await waitFor(() => expect(screen.getByText('tool-registry')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Tìm plugin'), { target: { value: 'docker' } })

    expect(screen.queryByText('tool-registry')).toBeNull()
    expect(screen.getByText('sandbox-docker')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lỗi fetch -> hiện thông báo lỗi, không throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginInventoryPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })

    await waitFor(() => expect(screen.getByText('forbidden')).toBeTruthy())
  })
})
