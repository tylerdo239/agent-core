// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectHub, type ProjectHubProps } from '../src/ProjectHub.tsx'

afterEach(cleanup)

function props(overrides: Partial<ProjectHubProps> = {}): ProjectHubProps {
  return {
    projects: [{ id: 'p1', name: 'Revenue 2026', createdAt: 1, updatedAt: Date.now() }],
    conversations: [], sources: [], outputs: [],
    onCreateProject: vi.fn(), onOpenProject: vi.fn(), onBack: vi.fn(),
    onStartConversation: vi.fn(), onOpenConversation: vi.fn(), onUpload: vi.fn(),
    onDownloadSource: vi.fn(), onDownloadOutput: vi.fn(), onPromoteOutput: vi.fn(),
    ...overrides,
  }
}

describe('ProjectHub', () => {
  it('lists and opens projects', () => {
    const onOpenProject = vi.fn()
    render(<ProjectHub {...props({ onOpenProject })} />)
    fireEvent.click(screen.getByText('Revenue 2026'))
    expect(onOpenProject).toHaveBeenCalledWith('p1')
  })

  it('keeps conversations and sources inside the selected project view', () => {
    const onOpenConversation = vi.fn()
    render(<ProjectHub {...props({
      activeProject: { id: 'p1', name: 'Revenue 2026', createdAt: 1, updatedAt: 2 },
      conversations: [{ id: 's1', title: 'Phân tích churn', createdAt: 2 }],
      sources: [{ path: 'sources/sales.csv', size: 1024, mtime: '', kind: 'dataset' }],
      onOpenConversation,
    })} />)
    fireEvent.click(screen.getByText('Phân tích churn'))
    expect(onOpenConversation).toHaveBeenCalledWith('s1')
    fireEvent.click(screen.getByText('Nguồn', { exact: false }))
    expect(screen.getByText('sales.csv')).toBeTruthy()
    expect(screen.getByText(/Nguồn dữ liệu/)).toBeTruthy()
  })

  it('separates session drafts from shared project outputs and promotes drafts explicitly', () => {
    const onPromoteOutput = vi.fn()
    render(<ProjectHub {...props({
      activeProject: { id: 'p1', name: 'Revenue 2026', createdAt: 1, updatedAt: 2 },
      outputs: [
        { path: 'final-report.pdf', size: 2048, mtime: '', scope: 'project' },
        { path: 'draft-chart.png', size: 1024, mtime: '', scope: 'session', sessionId: 's1', conversationTitle: 'Phân tích churn' },
      ],
      onPromoteOutput,
    })} />)
    fireEvent.click(screen.getByText('Output', { exact: false }))
    expect(screen.getByText('Output dự án')).toBeTruthy()
    expect(screen.getByText('Kết quả từ các đoạn chat')).toBeTruthy()
    fireEvent.click(screen.getByText('Đưa vào dự án'))
    expect(onPromoteOutput).toHaveBeenCalledWith(expect.objectContaining({ path: 'draft-chart.png', sessionId: 's1' }))
  })
})
