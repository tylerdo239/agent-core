// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MessageBubble } from '../src/MessageBubble.tsx'

afterEach(cleanup)

describe('MessageBubble activity description', () => {
  it('renders a short secondary description for timeline activities', () => {
    render(
      <MessageBubble
        kind="critic"
        text="📄 load dataset"
        description="Nạp sales.csv vào môi trường Python để xử lý."
      />,
    )

    expect(screen.getByText('📄 load dataset')).toBeTruthy()
    expect(screen.getByText('·')).toBeTruthy()
    expect(screen.getByText('Nạp sales.csv vào môi trường Python để xử lý.')).toBeTruthy()
  })
})
