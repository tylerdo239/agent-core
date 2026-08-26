// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { OutputPreviewModal } from '../src/OutputPreviewModal.tsx'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OutputPreviewModal', () => {
  it('preview text và cho tải hoặc xoá output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"score":0.9}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const onDownload = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const target = { path: 'generated/report.json', size: 13, endpoint: '/sessions/s1/files/generated%2Freport.json' }

    render(<OutputPreviewModal target={target} token="token" onClose={vi.fn()} onDownload={onDownload} onDelete={onDelete} />)

    await waitFor(() => expect(screen.getByText(/"score": 0.9/)).toBeTruthy())
    expect(fetch).toHaveBeenCalledWith(target.endpoint, expect.objectContaining({ headers: { authorization: 'Bearer token' } }))
    fireEvent.click(screen.getByText('Tải xuống'))
    expect(onDownload).toHaveBeenCalledWith(target)

    fireEvent.click(screen.getByText('Xoá output'))
    fireEvent.click(screen.getByText('Xoá', { exact: true }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(target))
  })
})
