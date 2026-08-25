// packages/ui-plugin-settings/src/PluginSettingsPanel.tsx — thay thế nút
// "Cấu hình" (restUrl/wsUrl) cũ: admin-only, cấu hình SECRET của plugin (vd.
// serperApiKey cho tool-web-search), lưu Postgres (ctx.pluginConfig) thay vì
// .env — đổi có hiệu lực NGAY, không cần restart service (xem
// bundles/tools/tool-web-search/index.ts đọc `ctx.get('pluginConfig')` mỗi
// lần handler chạy).
//
// Follow-up (2026-08), lần 2 — third-party extensibility: bản trước dùng 1
// mảng CATALOG hardcode ngay trong file này để biết "key nào cấu hình được,
// nhãn gì" — nghĩa là 1 tool bên thứ 3 nạp qua EXTRA_PLUGINS dù tự
// `ctx.tools.add()` với configSchema cũng KHÔNG THỂ xuất hiện ở đây nếu
// không sửa source lõi, phá đúng lời hứa "third-party không cần đụng
// source". Sửa: bỏ hẳn CATALOG, đọc GET /tool-config-schema
// (bundles/adapters/api-rest, tool TỰ khai `configSchema` ngay tại
// ToolDefinition của nó — seams/tools.ts) làm nguồn DUY NHẤT. Vì
// `ctx.tools.list()` (backend) chỉ chứa tool ĐANG THẬT SỰ mount (tool nào
// lỗi lúc mount thì `ctx.tools.add()` không bao giờ chạy), danh sách này
// LUÔN khớp thực tế server mà không cần cross-reference thêm với
// ctx.pluginInventory (Fiber state) như bản nháp trước — đơn giản hơn,
// không có 2 namespace tên lệch nhau (tên mount bundle vs tên tool logic).
//
// Bảo mật (đúng tinh thần dsh's ui-settings-plugins — "a key control starts
// blank, reports only whether one is configured"): input LUÔN bắt đầu rỗng
// dù đã cấu hình — GET /plugin-settings không bao giờ trả giá trị thật, chỉ
// trả "đã cấu hình hay chưa". Không gõ gì rồi bấm Lưu = không làm gì (giữ
// nguyên giá trị cũ), tránh lỡ tay ghi đè bằng chuỗi rỗng.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Button, Modal, Pill, Skeleton, TextField } from '@agent-core/ui-primitives'
import { type ConfigSchemaEntry, deletePluginSetting, listConfigSchema, listConfiguredKeys, savePluginSetting } from './pluginSettingsApi.ts'
import styles from './PluginSettingsPanel.module.css'

export interface PluginSettingsPanelProps {
  open: boolean
  onClose: () => void
  restUrl: string
  token: string
}

export function PluginSettingsPanel({ open, onClose, restUrl, token }: PluginSettingsPanelProps) {
  const [rows, setRows] = useState<ConfigSchemaEntry[]>([])
  const [configuredKeys, setConfiguredKeys] = useState<ReadonlySet<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busyKey, setBusyKey] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | undefined>()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(undefined)
    setDrafts({})
    setExpandedKey(undefined)
    Promise.all([listConfigSchema(restUrl, token), listConfiguredKeys(restUrl, token)])
      .then(([schema, keys]) => {
        setRows(schema)
        setConfiguredKeys(new Set(keys))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'không tải được cấu hình plugin'))
      .finally(() => setLoading(false))
  }, [open, restUrl, token])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = useMemo(
    () => rows.filter(
      (r) => normalizedQuery.length === 0
        || r.label.toLocaleLowerCase().includes(normalizedQuery)
        || r.toolName.toLocaleLowerCase().includes(normalizedQuery),
    ),
    [rows, normalizedQuery],
  )

  async function handleSave(key: string) {
    const value = (drafts[key] ?? '').trim()
    if (!value) return
    setBusyKey(key)
    setError(undefined)
    try {
      await savePluginSetting(restUrl, token, key, value)
      setConfiguredKeys((prev) => new Set(prev).add(key))
      setDrafts((prev) => ({ ...prev, [key]: '' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'không lưu được cấu hình')
    } finally {
      setBusyKey(undefined)
    }
  }

  async function handleClear(key: string) {
    setBusyKey(key)
    setError(undefined)
    try {
      await deletePluginSetting(restUrl, token, key)
      setConfiguredKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'không xoá được cấu hình')
    } finally {
      setBusyKey(undefined)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className={styles.wideDialog}>
      <div className={styles.wrap}>
        <h2 className={styles.title}>Cấu hình</h2>
        {error && <p className={styles.error}>{error}</p>}
        {loading ? (
          <Skeleton rows={3} />
        ) : (
          <>
            <TextField label="Tìm plugin" value={query} onChange={setQuery} placeholder="tên..." />
            <p className={styles.count}>{filtered.length}/{rows.length} plugin</p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Cấu hình</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isConfigured = configuredKeys.has(row.key)
                  const isExpanded = expandedKey === row.key
                  const busy = busyKey === row.key
                  return (
                    <Fragment key={row.key}>
                      <tr
                        className={styles.row}
                        onClick={() => setExpandedKey((prev) => (prev === row.key ? undefined : row.key))}
                        aria-expanded={isExpanded}
                      >
                        <td>{row.label}</td>
                        <td>
                          <Pill tone={isConfigured ? 'success' : 'neutral'}>{isConfigured ? 'đã cấu hình' : 'chưa cấu hình'}</Pill>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className={styles.detailRow}>
                          <td colSpan={2}>
                            <p className={styles.description}>{row.description}</p>
                            <div className={styles.formRow}>
                              <TextField
                                label={`Giá trị mới cho ${row.label}`}
                                type="password"
                                autoComplete="off"
                                placeholder={isConfigured ? 'Nhập giá trị mới để thay thế…' : 'Nhập API key…'}
                                value={drafts[row.key] ?? ''}
                                onChange={(value) => setDrafts((prev) => ({ ...prev, [row.key]: value }))}
                              />
                              <div className={styles.actions}>
                                <Button type="button" size="sm" disabled={busy || !(drafts[row.key] ?? '').trim()} onClick={() => handleSave(row.key)}>
                                  Lưu
                                </Button>
                                <Button type="button" size="sm" disabled={busy || !isConfigured} onClick={() => handleClear(row.key)}>
                                  Xoá
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className={styles.status}>Không có plugin nào đang mount có thể cấu hình.</p>}
            {rows.length > 0 && filtered.length === 0 && <p className={styles.status}>Không tìm thấy plugin phù hợp.</p>}
          </>
        )}
        <div className={styles.dialogActions}>
          <Button type="button" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </Modal>
  )
}
