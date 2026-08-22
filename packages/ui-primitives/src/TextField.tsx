// packages/ui-primitives/src/TextField.tsx — module auth: input có label
// dùng chung cho LoginForm/SignupForm/AdminUsersPanel (packages/ui-auth) —
// trước đây mỗi form tự viết <input> thô riêng (SettingsForm), giờ có 3 form
// mới cùng lúc nên tách thành primitive dùng chung thay vì lặp lại lần thứ
// 3-4. `error` (tuỳ chọn) hiện dòng lỗi ngay dưới input — dùng cho lỗi
// validate phía client (vd. "mật khẩu nhập lại không khớp"), KHÔNG phải nơi
// hiện lỗi API (đó là việc của Toast, theo đúng convention đã có).
import type { InputHTMLAttributes } from 'react'
import styles from './TextField.module.css'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
}

export function TextField({ label, value, onChange, error, id, ...rest }: TextFieldProps) {
  const inputId = id ?? `text-field-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div className={styles.wrap}>
      {/* Gap thật phát hiện lúc viết test: <span class="error"> trước đây nằm
          BÊN TRONG <label>, làm "tên accessible" của label bị nối thêm nội
          dung lỗi vào cùng (vd. "Mật khẩu" + "Mật khẩu quá ngắn") —
          getByLabelText(label) không còn khớp CHÍNH XÁC label gốc nữa. Error
          giờ là sibling NGOÀI label, không còn lẫn vào tên accessible. */}
      <label className={styles.field} htmlFor={inputId}>
        <span className={styles.label}>{label}</span>
        <input
          id={inputId}
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
