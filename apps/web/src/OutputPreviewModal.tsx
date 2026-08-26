import { useEffect, useState } from 'react'
import { Modal } from '@agent-core/ui-primitives'
import styles from './OutputPreviewModal.module.css'

export interface OutputPreviewTarget {
  path: string
  size: number
  endpoint: string
}

interface OutputPreviewModalProps {
  target: OutputPreviewTarget | null
  token: string
  onClose: () => void
  onDownload: (target: OutputPreviewTarget) => void
  onDelete: (target: OutputPreviewTarget) => Promise<void>
}

type PreviewContent =
  | { kind: 'image' | 'pdf'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'unsupported'; message: string }

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'csv', 'tsv', 'html', 'htm', 'xml', 'yaml', 'yml', 'log', 'py', 'js', 'ts', 'tsx', 'jsx', 'css'])
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024

function extension(path: string) {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function OutputPreviewModal({ target, token, onClose, onDownload, onDelete }: OutputPreviewModalProps) {
  const [content, setContent] = useState<PreviewContent | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!target) return
    const controller = new AbortController()
    let objectUrl = ''
    setLoading(true)
    setContent(null)
    setError('')
    setConfirmDelete(false)

    void fetch(target.endpoint, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      const blob = await response.blob()
      const ext = extension(target.path)
      const mime = (response.headers.get('content-type') ?? blob.type).split(';', 1)[0]
      if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
        objectUrl = URL.createObjectURL(blob)
        setContent({ kind: 'image', url: objectUrl })
      } else if (mime === 'application/pdf' || ext === 'pdf') {
        objectUrl = URL.createObjectURL(blob)
        setContent({ kind: 'pdf', url: objectUrl })
      } else if (mime.startsWith('text/') || mime === 'application/json' || TEXT_EXTENSIONS.has(ext)) {
        if (blob.size > MAX_TEXT_PREVIEW_BYTES) {
          setContent({ kind: 'unsupported', message: 'File text lớn hơn 2 MiB. Hãy tải xuống để xem đầy đủ.' })
        } else {
          let text = await blob.text()
          if (ext === 'json') {
            try { text = JSON.stringify(JSON.parse(text), null, 2) } catch { /* show raw JSON */ }
          }
          setContent({ kind: 'text', text })
        }
      } else {
        setContent({ kind: 'unsupported', message: 'Định dạng này chưa thể preview trong trình duyệt. Bạn vẫn có thể tải file xuống.' })
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [target, token])

  async function remove() {
    if (!target) return
    setDeleting(true)
    try {
      await onDelete(target)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal open={Boolean(target)} onClose={onClose} className={styles.modal}>
      {target && <section className={styles.panel} aria-label={`Preview ${target.path}`}>
        <header className={styles.header}>
          <div><span>Output preview</span><strong>{target.path}</strong><small>{formatSize(target.size)}</small></div>
          <button type="button" onClick={onClose} aria-label="Đóng preview">×</button>
        </header>
        <div className={styles.body}>
          {loading && <div className={styles.center}>Đang tải preview…</div>}
          {error && <div className={`${styles.center} ${styles.error}`}>Không mở được preview: {error}</div>}
          {content?.kind === 'image' && <img className={styles.image} src={content.url} alt={target.path} />}
          {content?.kind === 'pdf' && <iframe className={styles.frame} src={content.url} title={target.path} />}
          {content?.kind === 'text' && <pre className={styles.text}>{content.text}</pre>}
          {content?.kind === 'unsupported' && <div className={styles.center}>{content.message}</div>}
        </div>
        <footer className={styles.footer}>
          {confirmDelete ? <div className={styles.confirm}>
            <span>Xoá vĩnh viễn file này?</span>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Huỷ</button>
            <button type="button" className={styles.danger} onClick={remove} disabled={deleting}>{deleting ? 'Đang xoá…' : 'Xoá'}</button>
          </div> : <button type="button" className={styles.delete} onClick={() => setConfirmDelete(true)}>Xoá output</button>}
          <button type="button" className={styles.download} onClick={() => onDownload(target)}>Tải xuống</button>
        </footer>
      </section>}
    </Modal>
  )
}
