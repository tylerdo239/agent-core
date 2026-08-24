// packages/ui-plugin-inventory/src/PluginInventoryPanel.tsx — tham khảo dsh
// (packages/client/ui-settings-plugin-inventory — PluginInventorySettingsTab):
// danh sách read-only các bundle đang mount, lọc theo ô tìm kiếm, trạng thái
// Fiber hiện tại (point-in-time, đọc lại mỗi lần mở panel — KHÔNG cache,
// giống hệt triết lý ctx.pluginInventory.list() phía server, xem
// seams/plugin-inventory.ts). Khác dsh ở chỗ không có card mở rộng/chi tiết
// thêm (agent-core không có entryId/moduleName tách biệt như Loader tree
// của dsh — mỗi bundle chỉ có đúng 3 field name/category/state, không có gì
// thêm để "mở rộng xem"), và bọc Modal có sẵn (packages/ui-primitives) đúng
// pattern packages/ui-auth/src/AdminUsersPanel.tsx thay vì 1 tab riêng trong
// Settings (agent-core chưa có Settings dạng tab, xem SettingsForm.tsx).
import { useEffect, useMemo, useState } from 'react'
import { Modal, Pill, Skeleton, TextField } from '@agent-core/ui-primitives'
import { listPlugins, type PluginFiberState, type PluginInventoryEntry } from './pluginApi.ts'
import styles from './PluginInventoryPanel.module.css'

export interface PluginInventoryPanelProps {
  open: boolean
  onClose: () => void
  restUrl: string
  token: string
}

const STATE_LABEL: Record<PluginFiberState, string> = {
  pending: 'đang chờ',
  loading: 'đang tải',
  active: 'hoạt động',
  failed: 'lỗi',
  unloading: 'đang tắt',
  disposed: 'đã tắt',
}

const STATE_TONE: Record<PluginFiberState, 'neutral' | 'success' | 'error'> = {
  pending: 'neutral',
  loading: 'neutral',
  active: 'success',
  failed: 'error',
  unloading: 'neutral',
  disposed: 'neutral',
}

export function PluginInventoryPanel({ open, onClose, restUrl, token }: PluginInventoryPanelProps) {
  const [plugins, setPlugins] = useState<PluginInventoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(undefined)
    listPlugins(restUrl, token)
      .then(setPlugins)
      .catch((err) => setError(err instanceof Error ? err.message : 'không tải được danh sách plugin'))
      .finally(() => setLoading(false))
  }, [open, restUrl, token])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = useMemo(
    () => plugins.filter(
      (p) => normalizedQuery.length === 0
        || p.name.toLocaleLowerCase().includes(normalizedQuery)
        || p.category.toLocaleLowerCase().includes(normalizedQuery),
    ),
    [plugins, normalizedQuery],
  )

  return (
    <Modal open={open} onClose={onClose} className={styles.wideDialog}>
      <div className={styles.wrap}>
        <h2 className={styles.title}>Plugin đang chạy</h2>
        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <Skeleton rows={3} />
        ) : (
          <>
            <TextField label="Tìm plugin" value={query} onChange={setQuery} placeholder="tên hoặc nhóm..." />
            <p className={styles.count}>{filtered.length}/{plugins.length} plugin</p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Nhóm</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className={styles.category}>{p.category}</td>
                    <td>
                      <Pill tone={STATE_TONE[p.state]}>{STATE_LABEL[p.state]}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plugins.length === 0 && <p className={styles.status}>Không có plugin nào.</p>}
            {plugins.length > 0 && filtered.length === 0 && <p className={styles.status}>Không tìm thấy plugin phù hợp.</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
