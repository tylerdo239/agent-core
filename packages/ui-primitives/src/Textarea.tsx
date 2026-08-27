// packages/ui-primitives/src/Textarea.tsx — nhiều dòng, dùng cho
// ui-skill-manager (nội dung file .md của skill user tự thêm). Cùng cấu
// trúc/token với TextField.tsx (label ngoài, error sibling ngoài label) —
// xem comment ở đó cho lý do error KHÔNG nằm trong <label>.
import type { TextareaHTMLAttributes } from 'react'
import styles from './Textarea.module.css'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
}

export function Textarea({ label, value, onChange, error, id, ...rest }: TextareaProps) {
  const textareaId = id ?? `textarea-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div className={styles.wrap}>
      <label className={styles.field} htmlFor={textareaId}>
        <span className={styles.label}>{label}</span>
        <textarea
          id={textareaId}
          className={error ? `${styles.input} ${styles.inputError}` : styles.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
      </label>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}
