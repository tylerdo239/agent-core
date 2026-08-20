// packages/ui-primitives/src/Button.tsx — chuyển từ apps/web/src/Button.tsx
// (Phase 10.3) sang package dùng chung, không đổi logic/API.
import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'default'
  size?: 'md' | 'sm'
}

export function Button({ variant = 'default', size = 'md', className, ...rest }: ButtonProps) {
  const classes = [styles.button, variant === 'primary' ? styles.primary : '', size === 'sm' ? styles.sm : '', className]
    .filter(Boolean)
    .join(' ')
  return <button className={classes} {...rest} />
}
