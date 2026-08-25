import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileOutput, FileSpreadsheet, FileText, Folder, MessageSquare, Paperclip, Plus, Search, Share2 } from 'lucide-react'
import styles from './ProjectHub.module.css'

export interface ProjectSummary { id: string; name: string; createdAt: number; updatedAt: number }
export interface ProjectConversation { id: string; title: string; createdAt: number }
export interface ProjectFile { path: string; size: number; mtime: string; kind: 'dataset' | 'file' }
export interface ProjectOutputFile {
  path: string
  size: number
  mtime: string
  scope: 'project' | 'session'
  sessionId?: string
  conversationTitle?: string
}

export interface ProjectHubProps {
  projects: ProjectSummary[]
  activeProject?: ProjectSummary
  conversations: ProjectConversation[]
  sources: ProjectFile[]
  outputs: ProjectOutputFile[]
  loading?: boolean
  uploadProgress?: number
  onCreateProject: (name: string) => Promise<void> | void
  onOpenProject: (id: string) => void
  onBack: () => void
  onStartConversation: (message?: string) => void
  onOpenConversation: (id: string) => void
  onUpload: (file: File) => void
  onDownloadSource: (path: string) => void
  onDownloadOutput: (output: ProjectOutputFile) => void
  onPromoteOutput: (output: ProjectOutputFile) => void
}

function dateLabel(value: number) {
  const date = new Date(value)
  const today = new Date()
  return date.toDateString() === today.toDateString()
    ? 'Hôm nay'
    : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function ProjectHub(props: ProjectHubProps) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [tab, setTab] = useState<'chats' | 'sources' | 'outputs'>('chats')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const visible = useMemo(() => props.projects.filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase())), [props.projects, query])

  if (!props.activeProject) {
    return (
      <section className={styles.hub} aria-label="Dự án phân tích dữ liệu">
        <div className={styles.hero}>
          <div><p className={styles.eyebrow}>Phân tích dữ liệu</p><h1>Dự án</h1></div>
          <div className={styles.heroActions}>
            <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm dự án" /></label>
            <button type="button" className={styles.primary} onClick={() => setCreating(true)}><Plus size={17} /> Tạo</button>
          </div>
        </div>
        {creating && (
          <form className={styles.createRow} onSubmit={async (event) => { event.preventDefault(); if (!name.trim()) return; await props.onCreateProject(name.trim()); setName(''); setCreating(false) }}>
            <input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Tên dự án mới" />
            <button type="submit" className={styles.primary}>Tạo dự án</button>
            <button type="button" className={styles.secondary} onClick={() => setCreating(false)}>Huỷ</button>
          </form>
        )}
        <div className={styles.filterRow}><span className={styles.pill}>Tất cả</span><span>Do bạn tạo</span></div>
        <div className={styles.tableHead}><span>Tên</span><span>Đã sửa đổi</span></div>
        <div className={styles.projectList}>
          {visible.map((project) => (
            <button type="button" key={project.id} className={styles.projectRow} onClick={() => props.onOpenProject(project.id)}>
              <span className={styles.projectName}><span className={styles.folderIcon}><Folder size={18} /></span>{project.name}</span>
              <span>{dateLabel(project.updatedAt)}</span>
            </button>
          ))}
          {!props.loading && visible.length === 0 && <div className={styles.empty}>Chưa có dự án. Tạo một dự án để gom nguồn dữ liệu và các đoạn chat liên quan.</div>}
        </div>
      </section>
    )
  }

  const project = props.activeProject
  return (
    <section className={styles.hub} aria-label={`Dự án ${project.name}`}>
      <div className={styles.projectHeader}>
        <button type="button" className={styles.back} onClick={props.onBack} aria-label="Quay lại danh sách dự án"><ArrowLeft size={18} /></button>
        <Folder size={25} /><h1>{project.name}</h1>
      </div>
      <form className={styles.projectComposer} onSubmit={(event) => { event.preventDefault(); props.onStartConversation(prompt.trim() || undefined); setPrompt('') }}>
        <Plus size={20} />
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={`Đoạn chat mới trong ${project.name}`} />
        <button type="submit" disabled={!prompt.trim()}>Bắt đầu</button>
      </form>
      <div className={styles.tabs}>
        <button type="button" className={tab === 'chats' ? styles.activeTab : ''} onClick={() => setTab('chats')}>Đoạn chat <span>{props.conversations.length}</span></button>
        <button type="button" className={tab === 'sources' ? styles.activeTab : ''} onClick={() => setTab('sources')}>Nguồn <span>{props.sources.length}</span></button>
        <button type="button" className={tab === 'outputs' ? styles.activeTab : ''} onClick={() => setTab('outputs')}>Output <span>{props.outputs.length}</span></button>
      </div>
      {tab === 'chats' ? (
        <div className={styles.contentList}>
          {props.conversations.map((conversation) => (
            <button type="button" className={styles.contentRow} key={conversation.id} onClick={() => props.onOpenConversation(conversation.id)}>
              <MessageSquare size={18} /><span><strong>{conversation.title}</strong><small>{dateLabel(conversation.createdAt)}</small></span>
            </button>
          ))}
          {props.conversations.length === 0 && <div className={styles.empty}>Chưa có đoạn chat trong dự án này.</div>}
        </div>
      ) : tab === 'sources' ? (
        <div className={styles.sources}>
          <input ref={inputRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onUpload(file); event.currentTarget.value = '' }} />
          <button type="button" className={styles.dropzone} onClick={() => inputRef.current?.click()}>
            <Paperclip size={24} /><strong>Thêm nguồn cho dự án</strong><span>CSV, Excel, Parquet, JSON hoặc tài liệu — tối đa 70 MiB</span>
            {props.uploadProgress !== undefined && <span className={styles.progress}><i style={{ width: `${props.uploadProgress}%` }} /></span>}
          </button>
          <div className={styles.contentList}>
            {props.sources.map((file) => {
              const Icon = file.kind === 'dataset' ? FileSpreadsheet : FileText
              return <button type="button" className={styles.contentRow} key={file.path} onClick={() => props.onDownloadSource(file.path)}><Icon size={18} /><span><strong>{file.path.replace(/^sources\//, '')}</strong><small>{file.kind === 'dataset' ? 'Nguồn dữ liệu' : 'Tệp đầu vào'} · {(file.size / 1024).toFixed(1)} KB</small></span></button>
            })}
            {props.sources.length === 0 && <div className={styles.empty}>Chưa có nguồn đầu vào trong dự án.</div>}
          </div>
        </div>
      ) : (
        <div className={styles.outputs}>
          <OutputGroup
            title="Output dự án"
            description="Kết quả đã được chọn để mọi đoạn chat trong dự án sử dụng."
            files={props.outputs.filter((file) => file.scope === 'project')}
            onDownload={props.onDownloadOutput}
          />
          <OutputGroup
            title="Kết quả từ các đoạn chat"
            description="Bản nháp nằm riêng theo từng cuộc chat; đưa vào dự án khi muốn chia sẻ."
            files={props.outputs.filter((file) => file.scope === 'session')}
            onDownload={props.onDownloadOutput}
            onPromote={props.onPromoteOutput}
          />
        </div>
      )}
    </section>
  )
}

function OutputGroup(props: {
  title: string
  description: string
  files: ProjectOutputFile[]
  onDownload: (output: ProjectOutputFile) => void
  onPromote?: (output: ProjectOutputFile) => void
}) {
  return <section className={styles.outputGroup}>
    <div className={styles.outputHeading}><div><h2>{props.title}</h2><p>{props.description}</p></div><span>{props.files.length}</span></div>
    <div className={styles.contentList}>
      {props.files.map((file) => <div className={styles.outputRow} key={`${file.scope}:${file.sessionId ?? 'project'}:${file.path}`}>
        <button type="button" className={styles.outputFile} onClick={() => props.onDownload(file)}>
          <FileOutput size={18} />
          <span><strong>{file.path.replace(/^legacy\//, '')}</strong><small>{file.scope === 'project' ? 'Dùng chung trong dự án' : file.conversationTitle || `Đoạn chat ${file.sessionId?.slice(0, 8)}`} · {(file.size / 1024).toFixed(1)} KB</small></span>
        </button>
        {props.onPromote && <button type="button" className={styles.promote} onClick={() => props.onPromote?.(file)}><Share2 size={15} /> Đưa vào dự án</button>}
      </div>)}
      {props.files.length === 0 && <div className={styles.empty}>Chưa có output.</div>}
    </div>
  </section>
}
