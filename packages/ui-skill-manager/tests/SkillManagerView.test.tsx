// @vitest-environment jsdom
//
// SkillManagerView là 1 panel thuần (section, KHÔNG phải Modal) render thế
// chỗ khung chat trong AppFrame — cùng pattern packages/ui-projects/tests
// cho ProjectHub, không cần polyfill HTMLDialogElement như bản Modal cũ.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SkillManagerView } from '../src/SkillManagerView.tsx'

const SKILL = {
  name: 'meeting-notes',
  description: 'Tóm tắt biên bản họp',
  instructions: '# Meeting notes\nLuôn ghi rõ action item.',
  triggers: ['meeting', 'họp'],
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SkillManagerView', () => {
  it('render -> GET /custom-skills, hiện đúng tên/mô tả skill', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ skills: [SKILL] }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<SkillManagerView restUrl="http://localhost:8787" token="tok" />)
    })

    await waitFor(() => expect(screen.getByText('meeting-notes')).toBeTruthy())
    expect(screen.getByText('Tóm tắt biên bản họp')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/custom-skills', { headers: { authorization: 'Bearer tok' } })
  })

  it('chưa có skill nào -> hiện thông báo trống, không throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ skills: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<SkillManagerView restUrl="http://localhost:8787" token="tok" />)
    })

    await waitFor(() => expect(screen.getByText(/Bạn chưa có skill nào/)).toBeTruthy())
  })

  it('bấm "+ Thêm skill mới" -> hiện form chi tiết với nút back; nút Tạo disabled tới khi đủ field; submit -> POST đúng payload, gọi onChanged', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: true, status: 201, json: async () => SKILL })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ skills: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()

    await act(async () => {
      render(<SkillManagerView restUrl="http://localhost:8787" token="tok" onChanged={onChanged} />)
    })
    await waitFor(() => expect(screen.getByText(/Bạn chưa có skill nào/)).toBeTruthy())

    fireEvent.click(screen.getByText('Thêm skill mới'))
    expect(screen.getByLabelText('Quay lại danh sách kỹ năng')).toBeTruthy()
    const createButton = (await screen.findByText('Tạo')) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Tên (slug)'), { target: { value: 'meeting-notes' } })
    fireEvent.change(screen.getByLabelText('Mô tả ngắn'), { target: { value: 'Tóm tắt biên bản họp' } })
    fireEvent.change(screen.getByLabelText('Trigger (cách nhau bởi dấu phẩy)'), { target: { value: 'meeting, họp' } })
    fireEvent.change(screen.getByLabelText('Nội dung (.md)'), { target: { value: '# Meeting notes' } })
    expect(createButton.disabled).toBe(false)

    fireEvent.click(createButton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/custom-skills',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'Bearer tok' }),
          body: JSON.stringify({
            name: 'meeting-notes',
            description: 'Tóm tắt biên bản họp',
            instructions: '# Meeting notes',
            triggers: ['meeting', 'họp'],
          }),
        }),
      ),
    )
    // Sau khi lưu -> quay lại danh sách, thấy đúng skill vừa tạo.
    await waitFor(() => expect(screen.getByText('meeting-notes')).toBeTruthy())
    // Gap thật đã sửa: dropdown "Chọn skill" ở Composer (App.tsx) fetch
    // /skills đúng 1 lần lúc mount, không tự thấy skill mới tạo — onChanged
    // là cách App.tsx biết để refetch ngay, không đợi reload trang.
    expect(onChanged).toHaveBeenCalled()
  })

  it('bấm nút back trong form -> quay lại danh sách, KHÔNG gọi API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ skills: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<SkillManagerView restUrl="http://localhost:8787" token="tok" />)
    })
    await waitFor(() => expect(screen.getByText(/Bạn chưa có skill nào/)).toBeTruthy())

    fireEvent.click(screen.getByText('Thêm skill mới'))
    expect(screen.getByLabelText('Quay lại danh sách kỹ năng')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Quay lại danh sách kỹ năng'))
    await waitFor(() => expect(screen.getByText(/Bạn chưa có skill nào/)).toBeTruthy())
  })

  it('bấm vào 1 skill -> mở form sửa với tên bị khoá, submit -> PUT đúng tên trên URL', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...SKILL, description: 'mô tả mới' }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ skills: [SKILL] }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<SkillManagerView restUrl="http://localhost:8787" token="tok" />)
    })
    await waitFor(() => expect(screen.getByText('meeting-notes')).toBeTruthy())

    fireEvent.click(screen.getByText('meeting-notes'))
    const nameField = (await screen.findByLabelText('Tên (slug)')) as HTMLInputElement
    expect(nameField.disabled).toBe(true)
    expect(nameField.value).toBe('meeting-notes')

    fireEvent.change(screen.getByLabelText('Mô tả ngắn'), { target: { value: 'mô tả mới' } })
    fireEvent.click(screen.getByText('Lưu'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/custom-skills/meeting-notes',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
    await waitFor(() => expect(screen.getByText('mô tả mới')).toBeTruthy())
  })

  it('bấm "Xoá" trên danh sách -> DELETE đúng tên, skill biến mất, gọi onChanged', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: async () => ({}) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ skills: [SKILL] }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()

    await act(async () => {
      render(<SkillManagerView restUrl="http://localhost:8787" token="tok" onChanged={onChanged} />)
    })
    await waitFor(() => expect(screen.getByText('meeting-notes')).toBeTruthy())

    fireEvent.click(screen.getByText('Xoá'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/custom-skills/meeting-notes',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
    await waitFor(() => expect(screen.queryByText('meeting-notes')).toBeNull())
    expect(onChanged).toHaveBeenCalled()
  })

  it('lỗi fetch (409, tên trùng) -> hiện thông báo lỗi, không throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'skill "x" đã tồn tại' }) })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<SkillManagerView restUrl="http://localhost:8787" token="tok" />)
    })

    await waitFor(() => expect(screen.getByText('skill "x" đã tồn tại')).toBeTruthy())
  })
})
