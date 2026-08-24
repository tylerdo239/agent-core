// packages/ui-settings-general/src/SettingsForm.tsx — trích ra từ JSX inline
// trong App.tsx (form cấu hình REST/WS URL + API key) ở phase restructure UI
// mirror dsh (packages/client/ui-settings-general) — thuần trích xuất, KHÔNG
// đổi hành vi. Modal bọc ngoài (packages/ui-primitives Modal) vẫn do App.tsx
// tự quản (settingsOpen state, mở/đóng) — component này chỉ là nội dung form.
//
// Module auth (nhiều người dùng thật): field API Key đã XOÁ — danh tính giờ
// qua đăng nhập thật (packages/ui-auth), form này chỉ còn cấu hình URL kết
// nối thuần tuý.
import type { FormEvent } from 'react'
import { Button } from '@agent-core/ui-primitives'
import type { Settings } from './settings.ts'
import styles from './SettingsForm.module.css'

export interface SettingsFormProps {
  draft: Settings
  onChange: (next: Settings) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
}

export function SettingsForm({ draft, onChange, onSubmit, onCancel }: SettingsFormProps) {
  return (
    <form className={styles.settingsForm} onSubmit={onSubmit}>
      <h2>Cấu hình kết nối</h2>
      <label>
        REST URL
        <input
          type="text"
          placeholder="http://localhost:8787"
          value={draft.restUrl}
          onChange={(e) => onChange({ ...draft, restUrl: e.target.value })}
        />
      </label>
      <label>
        WebSocket URL
        <input
          type="text"
          placeholder="ws://localhost:8788"
          value={draft.wsUrl}
          onChange={(e) => onChange({ ...draft, wsUrl: e.target.value })}
        />
      </label>
      <p className={styles.hint}>Lưu trong localStorage của trình duyệt này — không gửi đi đâu khác ngoài 2 URL ở trên.</p>
      <div className={styles.dialogActions}>
        <Button type="button" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="submit" variant="primary">
          Lưu &amp; kết nối
        </Button>
      </div>
    </form>
  )
}
