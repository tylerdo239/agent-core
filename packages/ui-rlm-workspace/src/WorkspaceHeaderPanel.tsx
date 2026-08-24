// packages/ui-rlm-workspace/src/WorkspaceHeaderPanel.tsx — UI-plugin RLM
// (docs/agent-core-rlm-web-ui-plugin-plan.md): trích nguyên JSX "workspace
// bar" từng nằm cứng trong apps/web/src/App.tsx (header của AppFrame),
// KHÔNG đổi hành vi/markup/class name (vẫn dùng đúng class thuần trong
// apps/web/src/style.css — package này không có CSS riêng, tái dùng style
// global sẵn có).
//
// Component THUẦN, không tự fetch (coding rule ui-plugin-build-guide.md mục
// 4 rule 4-5): mọi dữ liệu qua props, App.tsx vẫn là nguồn sự thật DUY NHẤT
// cho workspace state + các lời gọi API thật. `<input type="file">` sở hữu
// NGAY TRONG component (đóng gói DOM ref cục bộ) — App.tsx chỉ nhận
// `onUpload(file)` với 1 File thật, không cần biết chi tiết DOM input.
import { useRef } from 'react'
import { Button } from '@agent-core/ui-primitives'

export interface WorkspaceEntry {
  path: string
  size: number
  mtime: string
  kind: 'dataset' | 'output' | 'file'
}

export interface WorkspaceUploadState {
  phase: 'uploading' | 'success' | 'error'
  filename: string
  progress: number
  message?: string
}

export interface WorkspaceHeaderPanelProps {
  uploadDisabled: boolean
  refreshDisabled: boolean
  onUpload: (file: File) => void
  onRefresh: () => void
  onDownload: (path: string) => void
  datasetsCount: number
  artifactsCount: number
  loading: boolean
  error: string
  uploadState: WorkspaceUploadState | null
  entries: WorkspaceEntry[]
}

export function WorkspaceHeaderPanel({
  uploadDisabled,
  refreshDisabled,
  onUpload,
  onRefresh,
  onDownload,
  datasetsCount,
  artifactsCount,
  loading,
  error,
  uploadState,
  entries,
}: WorkspaceHeaderPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) onUpload(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <>
      <div id="workspace-bar">
        <div className="workspace-bar-left">
          <span className="workspace-bar-title">Workspace</span>
          {datasetsCount > 0 && <span className="workspace-bar-count">{datasetsCount} dataset(s)</span>}
          {artifactsCount > 0 && <span className="workspace-bar-count">{artifactsCount} output(s)</span>}
          {entries.length === 0 && <span className="workspace-bar-count" style={{ opacity: 0.6 }}>chưa có file</span>}
          {loading && <span className="workspace-bar-count">đang cập nhật…</span>}
        </div>
        <div className="workspace-bar-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,.parquet,.json,.txt"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Button variant="default" disabled={uploadDisabled} onClick={() => fileInputRef.current?.click()}>📎 Upload file</Button>
          <Button variant="default" disabled={refreshDisabled} onClick={onRefresh}>↻ Refresh</Button>
        </div>
      </div>
      {uploadState && (
        <div id="upload-status" className={`upload-${uploadState.phase}`} role="status" aria-live="polite">
          <div className="upload-status-label">
            <span>{uploadState.phase === 'uploading' ? `Đang upload ${uploadState.filename}` : uploadState.phase === 'success' ? `✓ ${uploadState.filename}` : `✕ ${uploadState.filename}`}</span>
            <span>{uploadState.phase === 'uploading' ? `${uploadState.progress}%` : uploadState.message}</span>
          </div>
          <div className="upload-progress-track">
            <div className="upload-progress-bar" style={{ width: `${uploadState.progress}%` }} />
          </div>
        </div>
      )}
      {error && <div id="workspace-error" role="alert">Không đọc được workspace: {error}</div>}
      <div id="workspace-files">
        {entries.length === 0 && uploadState?.phase !== 'uploading' && (
          <span className="workspace-empty">Chưa có file — bấm 📎 Upload để thêm CSV/Excel</span>
        )}
        {entries.map((file) => (
          <button
            key={file.path}
            type="button"
            className={`workspace-file workspace-file-${file.kind}`}
            onClick={() => onDownload(file.path)}
            title={`Tải ${file.path}${file.size ? ` · ${(file.size / 1024).toFixed(1)} KB` : ''}`}
          >
            <span>{file.kind === 'output' ? '📦 Output' : file.kind === 'dataset' ? '▦ Dataset' : '📄 File'}</span>
            <strong>{file.path}</strong>
            {file.size > 0 && <span className="workspace-file-size">{(file.size / 1024).toFixed(1)} KB</span>}
          </button>
        ))}
      </div>
    </>
  )
}
