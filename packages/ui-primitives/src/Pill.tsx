// packages/ui-primitives/src/Pill.tsx — huy hiệu nhỏ dạng viên thuốc, dùng
// cho status badge (formalize từ `.status` CSS trước đây trong apps/web).
import type { ReactNode } from 'react'
import styles from './Pill.module.css'

export interface PillProps {
  tone?: 'neutral' | 'success' | 'error' | 'accent'
  children: ReactNode
}

export function Pill({ tone = 'neutral', children }: PillProps) {
  const classes = [styles.pill, tone !== 'neutral' ? styles[tone] : ''].filter(Boolean).join(' ')
  return <span className={classes}>{children}</span>
}
