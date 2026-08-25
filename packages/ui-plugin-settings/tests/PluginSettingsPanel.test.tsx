// @vitest-environment jsdom
//
// PluginSettingsPanel bọc Modal (<dialog> thật) -- cùng giới hạn môi trường
// test đã gặp khắp nơi trong repo: jsdom không implement showModal()/close().
// Cùng pattern packages/ui-plugin-inventory/tests/PluginInventoryPanel.test.tsx.
//
// Follow-up (2026-08), lần 2: bỏ hẳn CATALOG hardcode -- panel giờ đọc GET
// /tool-config-schema (tool tự khai configSchema, seams/tools.ts) làm nguồn
// DUY NHẤT, không còn cross-reference với GET /plugins/ctx.pluginInventory
// nữa (đơn giản hơn bản nháp trước, xem comment đầu PluginSettingsPanel.tsx).
// Dòng trong bảng mặc định CHƯA mở rộng, phải bấm vào mới thấy input/Lưu/Xoá.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PluginSettingsPanel } from '../src/PluginSettingsPanel.tsx'

const SCHEMA_RESPONSE = {
  entries: [{ toolName: 'web_search', key: 'serperApiKey', label: 'Web search Serper', description: 'mô tả test' }],
}

function mockFetch(configured: string[]) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.endsWith('/tool-config-schema')) return Promise.resolve({ ok: true, status: 200, json: async () => SCHEMA_RESPONSE })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ configured }) })
  })
}

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

describe('PluginSettingsPanel', () => {
  it('mở panel -> GET /tool-config-schema + /plugin-settings, hiện dòng tool tự khai config với badge "chưa cấu hình"', async () => {
    const fetchMock = mockFetch([])
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginSettingsPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })

    await waitFor(() => expect(screen.getByText('Web search Serper')).toBeTruthy())
    expect(screen.getByText('chưa cấu hình')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/tool-config-schema', { headers: { authorization: 'Bearer tok' } })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/plugin-settings', { headers: { authorization: 'Bearer tok' } })
  })

  it('không có tool nào khai configSchema -> hiện thông báo trống, không throw', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/tool-config-schema')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ entries: [] }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ configured: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginSettingsPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })

    await waitFor(() => expect(screen.getByText('Không có plugin nào đang mount có thể cấu hình.')).toBeTruthy())
  })

  it('bấm dòng -> mở rộng form; đã cấu hình -> input vẫn rỗng (không lộ giá trị thật)', async () => {
    const fetchMock = mockFetch(['serperApiKey'])
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginSettingsPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })

    await waitFor(() => expect(screen.getByText('đã cấu hình')).toBeTruthy())
    expect(screen.queryByLabelText('Giá trị mới cho Web search Serper')).toBeNull()

    fireEvent.click(screen.getByText('Web search Serper'))

    const input = (await screen.findByLabelText('Giá trị mới cho Web search Serper')) as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('nút "Lưu" disabled khi input rỗng; gõ giá trị -> bấm Lưu -> PUT đúng key/value, badge chuyển "đã cấu hình"', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/tool-config-schema')) return Promise.resolve({ ok: true, status: 200, json: async () => SCHEMA_RESPONSE })
      if (init?.method === 'PUT') return Promise.resolve({ ok: true, status: 200, json: async () => ({ key: 'serperApiKey', configured: true }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ configured: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginSettingsPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })
    await waitFor(() => expect(screen.getByText('chưa cấu hình')).toBeTruthy())
    fireEvent.click(screen.getByText('Web search Serper'))

    const saveButton = (await screen.findByText('Lưu')) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Giá trị mới cho Web search Serper'), { target: { value: 'real-key-123' } })
    expect(saveButton.disabled).toBe(false)

    fireEvent.click(saveButton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/plugin-settings/serperApiKey',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ authorization: 'Bearer tok' }),
          body: JSON.stringify({ value: 'real-key-123' }),
        }),
      ),
    )
    await waitFor(() => expect(screen.getByText('đã cấu hình')).toBeTruthy())
  })

  it('nút "Xoá" disabled khi chưa cấu hình; đã cấu hình -> bấm Xoá -> DELETE đúng key, badge chuyển "chưa cấu hình"', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/tool-config-schema')) return Promise.resolve({ ok: true, status: 200, json: async () => SCHEMA_RESPONSE })
      if (init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: async () => ({}) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ configured: ['serperApiKey'] }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginSettingsPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })
    await waitFor(() => expect(screen.getByText('đã cấu hình')).toBeTruthy())
    fireEvent.click(screen.getByText('Web search Serper'))

    const clearButton = (await screen.findByText('Xoá')) as HTMLButtonElement
    expect(clearButton.disabled).toBe(false)
    fireEvent.click(clearButton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/plugin-settings/serperApiKey',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
    await waitFor(() => expect(screen.getByText('chưa cấu hình')).toBeTruthy())
  })

  it('lỗi fetch (403) -> hiện thông báo lỗi, không throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<PluginSettingsPanel open restUrl="http://localhost:8787" token="tok" onClose={vi.fn()} />)
    })

    await waitFor(() => expect(screen.getByText('forbidden')).toBeTruthy())
  })
})
