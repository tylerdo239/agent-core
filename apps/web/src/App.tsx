// apps/web/src/App.tsx — Phase 9.4: cây component chính, thay renderStep()/
// addMessage() thủ công trong app.js cũ (Phase 7/8.5) bằng state React.
//
// Phase 6.3 (gộp WS vào api-rest, WS thành downlink-only): giao thức đổi so
// với Phase 9.4 gốc — WS KHÔNG còn nhận `create_session`/`send_message` từ
// client nữa (bundles/adapters/api-ws đã gộp vào api-rest, xem header file
// đó). Luồng mới: `POST /sessions` (REST) tạo session -> mở WS
// `/sessions/:id/events/stream?token=...` (chỉ để NHẬN step/done/error) ->
// `POST /sessions/:id/messages` (REST) mới thực sự gửi tin nhắn. WS không
// còn message type `session_created` — sessionId lấy thẳng từ response JSON
// của chính POST /sessions. `clientCtx` (cây Cordis riêng chạy trong trình duyệt, Phase 9.4)
// dùng cho `RenderSlot(clientCtx, 'tool.call.toolview', ...)` tại đúng chỗ
// turn có tool call — GenericToolCard (Phase 9.4) là fallback bắt buộc khi
// tool không có UI-plugin riêng (Phase 9.5 chưa mount cái nào, nên mọi tool
// call hiện tại đều rơi vào đường fallback này — đúng như thiết kế).
//
// Restructure UI mirror dsh (2026-08): Sidebar/SearchModal/sessionHistory/
// sidebarState -> packages/ui-sidebar; MessageBubble/Composer/ToolRow/
// GenericToolCard/EmptyState/AssistantMarkdown/StreamingRow ->
// packages/ui-conversation; SettingsForm/settings.ts ->
// packages/ui-settings-general; AppFrame (shell #app/#main/header/#messages,
// MỚI trích ra) -> packages/ui-layout. App.tsx giờ CHỈ còn WS/session state
// + compose các package trên qua <AppFrame> — KHÔNG đổi hành vi, thuần
// relocation (xem docs/agent-core-ui-architecture.md cho lý do/ranh giới
// đầy đủ). WS/session state (connect/applyStep/reconstructItems/
// handleSubmit) CHỦ ĐÍCH ở lại đây, không tách thành "controller" riêng như
// dsh — 1 consumer duy nhất, tách thêm không có lợi ích thật.
//
// Module auth (nhiều người dùng thật, 2026-08): API key dùng chung đã bị
// THAY THẾ hoàn toàn bằng tài khoản thật (packages/ui-auth) — `auth` state
// mới (token + user) là ĐIỀU KIỆN render toàn bộ khung chat. React rules of
// hooks: MỌI hook vẫn gọi KHÔNG ĐIỀU KIỆN mỗi render — chỉ THÂN effect gate
// theo `auth`, nhánh "chưa đăng nhập -> return LoginForm/SignupForm" nằm
// SAU toàn bộ hook, ngay trước JSX chính (đúng pattern "loading gate", không
// vi phạm rules of hooks). `sessions` giờ tải qua GET /sessions thật (server
// tự lọc đúng session CỦA CHÍNH caller nhờ ownerId) thay vì localStorage —
// xem packages/ui-sidebar/src/sessionHistory.ts cho lý do đầy đủ.
import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { RenderSlot } from '@agent-core/ui-react'
import type { ToolViewOwnerProps } from '@agent-core/ui-slots'
import { ToastContainer, useToasts } from '@agent-core/ui-primitives'
import { AppFrame } from '@agent-core/ui-layout'
import { AdminUsersPanel, clearAuthState, loadAuthState, LoginForm, saveAuthState, SignupForm, type AuthState } from '@agent-core/ui-auth'
import { PluginInventoryPanel } from '@agent-core/ui-plugin-inventory'
import { cacheSessionTitle, fetchSessionHistory, Sidebar, type SessionSummary } from '@agent-core/ui-sidebar'
import { Composer, EmptyState, GenericToolCard, HumanDecision, MessageBubble, StreamingRow, ToolRow } from '@agent-core/ui-conversation'
import { loadSettings, type Settings } from '@agent-core/ui-settings-general'
import { PluginSettingsPanel } from '@agent-core/ui-plugin-settings'
import { ProjectHub, type ProjectOutputFile, type ProjectSummary } from '@agent-core/ui-projects'
import type { WorkspaceHeaderPanelProps } from '@agent-core/ui-rlm-workspace'
import { createClientContext } from './client-context.ts'
import { OutputPreviewModal, type OutputPreviewTarget } from './OutputPreviewModal.tsx'

type ToolUiHint = ToolViewOwnerProps['toolUi']

interface LoopStep {
  // 'user_message' KHÔNG bao giờ đến qua step LIVE (agent/step) — chỉ xuất
  // hiện khi đọc lại event log THẬT qua GET /sessions/:id/events (xem
  // reconstructItems()). Gộp chung interface để dùng lại 1 type cho cả 2
  // nguồn (LoopStep từ WS 'step' và StoredEvent từ REST), tránh 2 kiểu dữ
  // liệu gần giống nhau song song.
  type:
    | 'user_message'
    // Follow-up (2026-08): 1 mảnh nội dung MỚI trong lúc model đang generate
    // (xem seams/loop.ts) — chỉ đến qua WS LIVE, không bao giờ xuất hiện khi
    // đọc lại event log THẬT (không lưu storage), reconstructItems() không
    // cần biết type này.
    | 'token'
    | 'model_message'
    // Gap thật (user báo lại: RLM chạy nhưng UI chờ không hiện đang làm gì):
    // loop-rlm phát 'tool_call' RIÊNG (name/args tách khỏi step, không lồng
    // trong `toolCall` như model_message của loop-default) NGAY LÚC model
    // quyết định gọi tool — trước khi có 'tool_result'. Thiếu nhánh xử lý
    // type này khiến card tool không bao giờ được tạo trong lượt RLM, kéo
    // theo 'tool_result' sau đó cũng rơi (không tìm thấy tool đang active).
    | 'tool_call'
    | 'tool_result'
    | 'critic_message'
    | 'final'
    | 'final_answer'
    | 'analysis'
    | 'code'
    | 'observation'
    | 'human_decision'
    | 'error'
    | 'turn_started'
    | 'iteration_started'
    | 'iteration_completed'
    | 'subcall_result'
    | 'context_usage'
    | 'memory_updated'
    | 'skill_loaded'
    | 'skill_resource'
    | 'workspace_read'
    | 'workspace_write'
  content?: string
  toolCall?: { name: string; args: Record<string, unknown> }
  toolUi?: ToolUiHint
  name?: string
  args?: Record<string, unknown>
  result?: unknown
  message?: string
  control?: {
    kind?: string
    question?: string
    options?: unknown
    reason?: string
    action?: string
    request_id?: string
  }
  question?: string
  reason?: string
  code?: string
  action?: string
  path?: string
  skill?: string
  encoding?: string
}

type ChatItem =
  | { kind: 'user' | 'assistant' | 'system' | 'error' | 'critic'; id: string; text: string; description?: string; ts?: number }
  | {
      kind: 'tool'
      id: string
      toolCall: { name: string; args: Record<string, unknown> }
      toolUi?: ToolUiHint
      state: 'running' | 'ok' | 'error'
      result?: unknown
      errorText?: string
    }
  | {
      kind: 'control'
      id: string
      question: string
      options: string[]
      reason?: string
      requestId?: string
      answered?: string
    }

function humanControlItem(step: LoopStep): Extract<ChatItem, { kind: 'control' }> {
  const control = step.control
  const options = Array.isArray(control?.options)
    ? control.options.filter((option): option is string => typeof option === 'string' && Boolean(option.trim())).map((option) => option.trim())
    : []
  return {
    kind: 'control',
    id: genId(),
    question: control?.question || step.question || control?.action || step.action || 'RLM đang chờ quyết định của bạn.',
    options,
    reason: control?.reason || step.reason || undefined,
    requestId: control?.request_id || undefined,
  }
}

let nextId = 0
function genId(): string {
  nextId += 1
  return `item-${nextId}`
}

type ConnStatus = 'connecting' | 'connected' | 'disconnected'
type SkillOption = { name: string; description: string }
type WorkspaceFile = { path: string; size: number; mtime: string }
type WorkspaceDataset = { filename: string; path?: string }
type UploadState = {
  phase: 'uploading' | 'success' | 'error'
  filename: string
  progress: number
  message?: string
  completed?: number
  total?: number
}

const ACTIVE_SESSION_KEY_PREFIX = 'agent-core-ui-active-session:'

function activeSessionId(userId: string): string | null {
  return localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}${userId}`)
}

function rememberActiveSession(userId: string, sessionId: string): void {
  localStorage.setItem(`${ACTIVE_SESSION_KEY_PREFIX}${userId}`, sessionId)
}

async function fetchSessionEvents(restUrl: string, token: string, sessionId: string): Promise<LoopStep[]> {
  const response = await fetch(`${restUrl}/sessions/${sessionId}/events`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = (await response.json()) as { events?: LoopStep[] }
  return payload.events ?? []
}

function toolRowSummary(item: Extract<ChatItem, { kind: 'tool' }>): string {
  if (item.state === 'error') return item.errorText ?? 'lỗi'
  if (item.state === 'ok' && item.toolUi?.render === 'citations') {
    const results = (item.result as { results?: unknown[] } | undefined)?.results
    if (Array.isArray(results)) return results.length ? `${results.length} nguồn` : 'không tìm thấy kết quả'
  }
  // Đối chiếu dsh (WebBlock)/Claude: lúc tool ĐANG chạy, cả 2 hiện ngay câu
  // tìm kiếm/tham số thật (người đọc được), không phải JSON kỹ thuật thô —
  // tool tự khai field nào (`ToolUiHint.summaryArg`, seams/tools.ts) thay vì
  // UI đoán tên field theo tool cụ thể.
  if (item.state === 'running' && item.toolUi?.summaryArg) {
    const value = (item.toolCall.args as Record<string, unknown> | undefined)?.[item.toolUi.summaryArg]
    if (typeof value === 'string' && value) return `"${value}"`
  }
  return JSON.stringify(item.toolCall.args ?? {})
}

function workspaceReadActivity(step: Pick<LoopStep, 'action' | 'path'>) {
  const action = step.action ?? 'đọc'
  const normalized = action.toLowerCase()
  let description = 'Đọc dữ liệu từ workspace để phục vụ lượt phân tích hiện tại.'
  if (normalized === 'list datasets') description = 'Kiểm tra các dataset hiện có trong workspace.'
  else if (normalized === 'profile dataset') description = 'Đọc cấu trúc, kiểu dữ liệu và thống kê cơ bản của dataset.'
  else if (normalized === 'load dataset') description = `Nạp ${step.path || 'dataset'} vào môi trường Python để xử lý.`
  else if (normalized === 'list files') description = 'Kiểm tra các file hiện có trong workspace.'
  else if (normalized === 'read file') description = `Đọc ${step.path || 'file'} từ workspace.`
  return { text: `📄 ${action}`, description }
}

function workspaceWriteActivity(path = '') {
  const lower = path.toLowerCase()
  let description = 'Lưu kết quả vào workspace để tải xuống hoặc sử dụng ở lượt sau.'
  if (lower.endsWith('.json')) description = 'Lưu kết quả dạng JSON vào workspace để tải xuống hoặc dùng lại.'
  else if (/\.(md|html|pdf)$/.test(lower)) description = 'Lưu báo cáo hoàn chỉnh vào workspace.'
  else if (/\.(csv|parquet|xlsx)$/.test(lower)) description = 'Lưu dataset kết quả vào workspace.'
  if (path) description = `${description.replace(/\.$/, '')}: ${path}`
  return { text: '💾 ghi output', description }
}

export function App() {
  const [clientCtx, setClientCtx] = useState<Context | null>(null)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuthState())
  const [authView, setAuthView] = useState<'login' | 'signup'>('login')
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [sessionId, setSessionId] = useState<string | null>(null)
  // docs/agent-core-rlm-web-ui-plugin-plan.md mục 1/3: key để dispatch
  // 'session.chrome.header'/'session.chrome.composer' (ctx.slots, kind
  // 'keyed') — workspace bar/skill-select CHỈ hiện khi driver phiên hiện
  // tại có registrant khớp ('rlm'); 'default'/'planner-critic' rơi về
  // fallback null, không hiện gì.
  const [sessionDriver, setSessionDriver] = useState<string>('default')
  const [items, setItems] = useState<ChatItem[]>([])
  const [turnInFlight, setTurnInFlight] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
  const [pluginInventoryOpen, setPluginInventoryOpen] = useState(false)
  // Thay thế hoàn toàn nút "Cấu hình" (restUrl/wsUrl) cũ — web UI giờ luôn
  // trỏ 1 server cố định (defaultSettings() tính theo location.hostname,
  // đúng deployment Docker Compose thật), không cần UI đổi tay. Đổi hẳn
  // sang panel cấu hình PLUGIN (vd. serperApiKey), admin-only, lưu DB thay
  // vì .env — xem packages/ui-plugin-settings.
  const [pluginSettingsOpen, setPluginSettingsOpen] = useState(false)
  // Module auth (Phase 24): server GET /sessions là nguồn sự thật, KHÔNG
  // phải localStorage nữa (loadSessionHistory() cũ) — xem
  // packages/ui-sidebar/src/sessionHistory.ts.
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectView, setProjectView] = useState(false)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [skills, setSkills] = useState<SkillOption[]>([])
  const [selectedSkill, setSelectedSkill] = useState('')
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [workspaceDatasets, setWorkspaceDatasets] = useState<WorkspaceDataset[]>([])
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<string[]>([])
  const [projectOutputs, setProjectOutputs] = useState<ProjectOutputFile[]>([])
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [uploadState, setUploadState] = useState<UploadState | null>(null)
  const [outputPreview, setOutputPreview] = useState<OutputPreviewTarget | null>(null)

  const { toasts, push: pushToast } = useToasts()

  async function refreshWorkspaceFiles(sid: string, explicitProjectId?: string) {
    // Module auth: `Settings` không còn `apiKey` (Phase 24) — danh tính là
    // `auth.token`. Hàm này chỉ thực sự được gọi từ chỗ đã qua gate `!auth`
    // (WS handler trong connect()/resumeSession, hoặc nút bấm trong JSX sau
    // gate) nhưng là function declaration riêng, TS không tự narrow qua
    // ranh giới hàm — guard tường minh.
    if (!auth) return
    setWorkspaceLoading(true)
    try {
      const projectId = explicitProjectId ?? sessions.find((session) => session.id === sid)?.projectId
      if (projectId) {
        const headers = { authorization: `Bearer ${auth.token}` }
        const [sourceResponse, outputResponse] = await Promise.all([
          fetch(`${settings.restUrl}/projects/${projectId}/sources`, { headers }),
          fetch(`${settings.restUrl}/projects/${projectId}/outputs`, { headers }),
        ])
        if (!sourceResponse.ok) throw new Error(`HTTP ${sourceResponse.status}: ${await sourceResponse.text()}`)
        if (!outputResponse.ok) throw new Error(`HTTP ${outputResponse.status}: ${await outputResponse.text()}`)
        const sourceData = await sourceResponse.json() as { sources?: WorkspaceFile[]; datasets?: WorkspaceDataset[] }
        const outputData = await outputResponse.json() as {
          projectOutputs?: WorkspaceFile[]
          sessionOutputs?: Array<{ sessionId: string; files: WorkspaceFile[] }>
        }
        const mappedOutputs: ProjectOutputFile[] = [
          ...(outputData.projectOutputs ?? []).map((file) => ({ ...file, scope: 'project' as const })),
          ...(outputData.sessionOutputs ?? []).flatMap((group) => group.files.map((file) => ({
            ...file,
            scope: 'session' as const,
            sessionId: group.sessionId,
            conversationTitle: sessions.find((session) => session.id === group.sessionId)?.title,
          }))),
        ]
        setWorkspaceFiles(sourceData.sources ?? [])
        setWorkspaceDatasets(sourceData.datasets ?? [])
        setProjectOutputs(mappedOutputs)
        setWorkspaceArtifacts(mappedOutputs
          .filter((file) => file.scope === 'project' || file.sessionId === sid)
          .map((file) => file.scope === 'project' ? `outputs/${file.path}` : `generated/${file.path}`))
      } else {
        const res = await fetch(`${settings.restUrl}/sessions/${sid}/files`, { headers: { authorization: `Bearer ${auth.token}` } })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        const data = (await res.json()) as { files: WorkspaceFile[]; datasets: WorkspaceDataset[]; artifacts: string[] }
        setWorkspaceFiles(data.files ?? [])
        setWorkspaceDatasets(data.datasets ?? [])
        setWorkspaceArtifacts(data.artifacts ?? [])
        setProjectOutputs([])
      }
      setWorkspaceError('')
    } catch (error: unknown) {
      setWorkspaceError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkspaceLoading(false)
    }
  }

  // Workspace plugin sở hữu DOM input và chuyển một batch File[] cho App —
  // <input type="file"> giờ nằm TRONG WorkspaceHeaderPanel (ui-rlm-workspace),
  // App.tsx không còn sở hữu DOM input đó nữa, chỉ còn phần gọi API thật.
  async function handleFileUpload(files: File[]) {
    if (!auth) return
    if (!files.length) return
    let sid = sessionId
    const projectId = activeProjectId
    if (!sid && !projectId) {
      // Tự tạo session nếu chưa có (nhánh phòng thủ hiếm gặp — workspace bar
      // chỉ hiện cho session driver 'rlm' đã tồn tại, xem mục 3; vẫn giữ vì
      // race window hẹp giữa lúc bấm "Phân tích dữ liệu" và session_created
      // WS trả về).
      pushToast('Hãy tạo hoặc chọn một dự án trước khi upload nguồn.', 'error')
      return
    }
    const oversized = files.find((file) => file.size > 70 * 1024 * 1024)
    if (oversized) { pushToast(`${oversized.name} quá lớn (tối đa 70 MiB mỗi file).`, 'error'); return }
    const total = files.length
    let currentFile = files[0]
    let currentProgress = 0
    try {
      for (const [index, file] of files.entries()) {
        currentFile = file
        currentProgress = Math.round(index * 100 / total)
        setUploadState({ phase: 'uploading', filename: file.name, progress: currentProgress, completed: index, total })
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          const endpoint = projectId ? `/projects/${projectId}/sources` : `/sessions/${sid}/files`
          xhr.open('POST', `${settings.restUrl}${endpoint}`)
          xhr.setRequestHeader('authorization', `Bearer ${auth.token}`)
          xhr.setRequestHeader('content-type', 'application/octet-stream')
          xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const progress = Math.round(((index + e.loaded / e.total) / total) * 100)
              currentProgress = progress
              setUploadState({ phase: 'uploading', filename: file.name, progress, completed: index, total })
            }
          }
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || `HTTP ${xhr.status}`)))
          xhr.onerror = () => reject(new Error('Network error'))
          xhr.send(file)
        })
      }
      await refreshWorkspaceFiles(sid ?? '', projectId ?? undefined)
      const label = total === 1 ? files[0].name : `${total} file`
      setUploadState({ phase: 'success', filename: label, progress: 100, message: 'Đã upload và đăng ký trong workspace.', completed: total, total })
      pushToast(`Đã tải lên ${label}`, 'default')
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setUploadState({ phase: 'error', filename: currentFile.name, progress: currentProgress, message, total })
      pushToast(`Upload thất bại: ${message}`, 'error')
    }
  }

  async function downloadWorkspaceFile(filePath: string) {
    if ((!sessionId && !activeProjectId) || !auth) return
    try {
      const endpoint = workspaceFileEndpoint(filePath)
      if (!endpoint) return
      const response = await fetch(endpoint, {
        headers: { authorization: `Bearer ${auth.token}` },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filePath.split('/').pop() || 'download'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      pushToast(`Không tải được ${filePath}: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  function workspaceFileEndpoint(filePath: string): string | null {
    const projectId = activeProjectId ?? sessions.find((session) => session.id === sessionId)?.projectId
    if (projectId) {
      if (filePath.startsWith('generated/') && sessionId) {
        return `${settings.restUrl}/projects/${projectId}/outputs/session/${sessionId}/${encodeURIComponent(filePath.slice('generated/'.length))}`
      }
      if (filePath.startsWith('outputs/')) {
        return `${settings.restUrl}/projects/${projectId}/outputs/project/${encodeURIComponent(filePath.slice('outputs/'.length))}`
      }
      return `${settings.restUrl}/projects/${projectId}/files/${encodeURIComponent(filePath)}`
    }
    return sessionId ? `${settings.restUrl}/sessions/${sessionId}/files/${encodeURIComponent(filePath)}` : null
  }

  function projectOutputEndpoint(output: ProjectOutputFile): string | null {
    if (!activeProjectId) return null
    return output.scope === 'project'
      ? `${settings.restUrl}/projects/${activeProjectId}/outputs/project/${encodeURIComponent(output.path)}`
      : output.sessionId
        ? `${settings.restUrl}/projects/${activeProjectId}/outputs/session/${output.sessionId}/${encodeURIComponent(output.path)}`
        : null
  }

  function previewWorkspaceOutput(file: { path: string; size: number }) {
    const endpoint = workspaceFileEndpoint(file.path)
    if (endpoint) setOutputPreview({ path: file.path, size: file.size, endpoint })
  }

  function previewProjectOutput(output: ProjectOutputFile) {
    const endpoint = projectOutputEndpoint(output)
    if (endpoint) setOutputPreview({ path: output.path, size: output.size, endpoint })
  }

  async function downloadPreview(target: OutputPreviewTarget) {
    if (!auth) return
    try {
      const response = await fetch(target.endpoint, { headers: { authorization: `Bearer ${auth.token}` } })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = target.path.split('/').pop() || 'output'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      pushToast(`Không tải được output: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  async function deletePreview(target: OutputPreviewTarget) {
    if (!auth) return
    const response = await fetch(target.endpoint, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${auth.token}` },
    })
    if (!response.ok) {
      const message = `HTTP ${response.status}: ${await response.text()}`
      pushToast(`Không xoá được output: ${message}`, 'error')
      throw new Error(message)
    }
    setOutputPreview(null)
    await refreshWorkspaceFiles(sessionId ?? '', activeProjectId ?? undefined)
    pushToast(`Đã xoá ${target.path}`, 'default')
  }

  async function promoteProjectOutput(output: ProjectOutputFile) {
    if (!activeProjectId || !auth || output.scope !== 'session' || !output.sessionId) return
    const response = await fetch(`${settings.restUrl}/projects/${activeProjectId}/outputs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: output.sessionId, path: output.path }),
    })
    if (!response.ok) {
      pushToast(`Không đưa được output vào dự án: ${await response.text()}`, 'error')
      return
    }
    await refreshWorkspaceFiles(sessionId ?? '', activeProjectId)
    pushToast(`Đã đưa ${output.path} vào output chung của dự án.`, 'default')
  }

  const wsRef = useRef<WebSocket | null>(null)
  // sessionId mà wsRef.current ĐANG subscribe — khác sessionId (state, có thể
  // đã đổi sang session khác trước khi WS cũ kịp đóng). Dùng để biết có cần
  // mở lại stream hay tái dùng socket đang mở (Phase 6.3: 1 WS = 1 session).
  const wsSessionIdRef = useRef<string | null>(null)
  const activeToolItemIdRef = useRef<string | null>(null)
  // Follow-up (2026-08): id của ChatItem 'assistant' đang được ghép dần từ
  // các step 'token' (null = chưa có/đã đóng lại) — set khi token ĐẦU TIÊN
  // của 1 lượt generate tới, reset về null lúc model_message (có toolCall,
  // tool card mới sắp tạo) hoặc lúc 'final' đóng lại bubble đang stream.
  const streamingAssistantIdRef = useRef<string | null>(null)
  // Bug thật user báo (2026-08): "đôi khi vẫn gặp lỗi markdown table" —
  // AssistantMarkdown render lại qua react-markdown ở MỖI token; nếu turn
  // kết thúc/lỗi/bị cắt đúng lúc dòng phân cách bảng (`| --- | --- |`) đang
  // gõ dở thì bảng đứng yên mãi ở dạng cú pháp thô (xem chú thích đầy đủ ở
  // AssistantMarkdown.tsx). streamingAssistantIdRef ở trên PHẢI là ref (đọc
  // đồng bộ trong applyStep, closure của openStream() không được tạo lại
  // mỗi render — dùng state ở đó sẽ đọc phải giá trị cũ/stale). Nhưng quyết
  // định RENDER (bubble nào hiện text thô, bubble nào hiện markdown thật)
  // cần trigger re-render đúng lúc — ref không tự re-render được, nên thêm
  // state riêng, set ĐỒNG THỜI ở đúng 3 điểm ref đổi giá trị (không thay ref
  // bằng state — hai việc khác nhau, cần cả hai).
  const [streamingItemId, setStreamingItemId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  // Session hiện tại đã có tin nhắn user đầu tiên chưa — chỉ cập nhật title
  // lịch sử ĐÚNG 1 LẦN cho câu hỏi đầu tiên, không ghi đè bằng câu hỏi sau.
  const titledSessionIdsRef = useRef<Set<string>>(new Set())
  // Follow-up (2026-08), vẫn đúng ở Phase 6.3: bug thật user báo — mở app
  // hoặc bấm "Chat mới" rồi KHÔNG gõ gì, F5 lại thấy 1 session rỗng tự lưu
  // vào history. Sửa bằng cách hoãn việc TẠO session (giờ là `POST
  // /sessions`, trước đây là gửi `create_session` qua WS) tới đúng lúc
  // handleSubmit() gửi tin nhắn ĐẦU TIÊN — ref dưới đây nhớ driver session
  // MỚI sẽ tạo (mặc định 'default', đổi khi bấm "Phân tích dữ liệu").
  const pendingSessionDriverRef = useRef<'default' | 'rlm'>('default')

  // Phase 9.4: mount cây Cordis client 1 lần khi app khởi động — xem
  // client-context.ts cho lý do PHẢI async (ctx.slots chưa sẵn sàng đồng bộ
  // ngay sau ctx.plugin()).
  useEffect(() => {
    let disposed = false
    createClientContext().then((ctx) => {
      if (!disposed) setClientCtx(ctx)
    })
    return () => {
      disposed = true
    }
  }, [])

  // Follow-up (2026-08): tham khảo Claude/dsh — cuộn "smooth" cho item MỚI
  // (tin nhắn/tool card mới xuất hiện), nhưng KHÔNG smooth khi chỉ là
  // bubble đang stream lớn dần (items.length không đổi, chỉ text bên trong
  // đổi) — 1 lượt streaming gọi setItems() hàng chục lần (mỗi token, xem
  // applyStep()), smooth-scroll lặp lại liên tục sẽ tự dẫm lên chính nó
  // (animation trước bị ngắt bởi animation sau) gây giật thay vì mượt. Auto
  // (tức thời) trong lúc stream vẫn giữ đúng vị trí cuối trang, không giật.
  const prevItemsLengthRef = useRef(0)
  useEffect(() => {
    const last = items[items.length - 1]
    if (last?.kind === 'assistant') {
      let lastUserIndex = -1
      for (let index = items.length - 2; index >= 0; index -= 1) {
        if (items[index].kind === 'user') {
          lastUserIndex = index
          break
        }
      }
      const turnHasActivity = items
        .slice(lastUserIndex + 1, -1)
        .some((item) => item.kind === 'critic' || item.kind === 'tool')
      // Khi RLM vừa trả final, giữ viewport ở các activity cuối thay vì kéo
      // thẳng xuống cuối một answer dài làm timeline trông như biến mất.
      if (turnHasActivity) return
    }
    const isNewItem = items.length !== prevItemsLengthRef.current
    prevItemsLengthRef.current = items.length
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: isNewItem ? 'smooth' : 'auto' })
  }, [items])

  // Mở downlink WS cho ĐÚNG 1 session đã tồn tại (Phase 6.3: WS không còn
  // nhận create_session/send_message — chỉ subscribe step/done/error, xem
  // GET /sessions/:id/events/stream ở bundles/adapters/api-rest). Resolve
  // lúc socket 'open' — caller PHẢI await xong hàm này trước khi POST
  // /sessions/:id/messages, để không lỡ mất step đầu tiên (server emit
  // 'agent/step' đồng bộ ngay trong lúc xử lý message, xem seams/loop.ts).
  function openStream(current: Settings, token: string, sid: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${current.wsUrl}/sessions/${sid}/events/stream?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(url)
      let settled = false
      // Gán NGAY lúc tạo (không đợi 'open') — 'close'/'error' bên dưới cần so
      // sánh được `wsRef.current === ws` NGAY TỪ LÚC CONNECTING, không chỉ từ
      // lúc OPEN (xem lý do ở guard trong 'close').
      wsRef.current = ws

      ws.addEventListener('open', () => {
        wsSessionIdRef.current = sid
        setStatus('connected')
        settled = true
        resolve()
      })

      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data)

        if (msg.type === 'step') {
          applyStep(msg.step as LoopStep)
          return
        }

        if (msg.type === 'done') {
          setTurnInFlight(false)
          const sid = sessionIdRef.current ?? (msg as { sessionId?: string }).sessionId
          if (sid) refreshWorkspaceFiles(String(sid), activeProjectId ?? undefined)
          return
        }

        if (msg.type === 'error') {
          setTurnInFlight(false)
          // Tool throw (permission denied, lỗi network...) đi thẳng ra đây thay
          // vì qua step 'tool_result' — nếu đang có 1 tool item "đang chạy" dở,
          // chốt nó sang trạng thái lỗi luôn (đúng bug-fix đã có ở app.js cũ:
          // không để pulsing/shimmer mãi mãi).
          const activeId = activeToolItemIdRef.current
          if (activeId) {
            activeToolItemIdRef.current = null
            setItems((prev) =>
              prev.map((it) => (it.kind === 'tool' && it.id === activeId ? { ...it, state: 'error', errorText: msg.message } : it)),
            )
          }
          setItems((prev) => [...prev, { kind: 'error', id: genId(), text: `Lỗi: ${msg.message}`, ts: Date.now() }])
          return
        }
      })

      ws.addEventListener('close', (event) => {
        // Bug thật đã sửa (2026-08): CHỈ set 'disconnected' nếu socket đang
        // đóng vẫn còn là socket HIỆN HÀNH (wsRef.current === ws). startNewChat()/
        // ensureStream()/resumeSession() đều `.close()` socket CŨ rồi gán lại
        // wsRef.current (null hoặc socket MỚI) NGAY, đồng bộ — nhưng sự kiện
        // 'close' của socket cũ chỉ tới SAU đó, bất đồng bộ. Không guard thì
        // 'close' trễ của socket cũ ghi đè lên đúng status vừa set cho ngữ
        // cảnh MỚI (vd. "connected" mà startNewChat() vừa set) về lại
        // 'disconnected', khoá cứng composer vĩnh viễn vì không còn gì mở lại
        // WS (session mới chỉ tạo lúc gửi tin, mà gửi tin lại bị chính status
        // này chặn) — xảy ra mỗi khi có 1 WS đang mở từ session auto-resume lúc
        // load trang rồi user bấm "Chat mới"/đổi session ngay sau đó.
        if (wsRef.current === ws) setStatus('disconnected')
        if (wsSessionIdRef.current === sid) wsSessionIdRef.current = null
        // Module auth: 401 giờ nghĩa là TOKEN hết hạn/bị thu hồi (không còn
        // "sai API key" — token đã được xác thực lúc mở kết nối, hết hạn/bị
        // logout ở tab khác giữa chừng là kịch bản khác) — đăng xuất NGAY,
        // không để user tưởng vẫn còn phiên hợp lệ trong khi mọi request tiếp
        // theo đều sẽ 401.
        if (event.code === 401) {
          clearAuthState()
          setAuth(null)
          pushToast('Phiên đăng nhập đã hết hạn — vui lòng đăng nhập lại.', 'error')
        }
        if (!settled) {
          settled = true
          reject(new Error(`WS đóng trước khi mở (code=${event.code})`))
        }
      })

      ws.addEventListener('error', () => {
        // Cùng guard như 'close' ở trên — socket lỗi không còn là socket hiện
        // hành thì không được phép đổi status thay cho ngữ cảnh mới.
        if (wsRef.current === ws) setStatus('disconnected')
        if (!settled) {
          settled = true
          reject(new Error('WS connection error'))
        }
      })
    })
  }

  // Đảm bảo có đúng 1 WS đang mở, subscribe đúng `sid` — tái dùng socket cũ
  // nếu đã đúng session và còn OPEN, ngược lại đóng cái cũ (nếu có) rồi mở
  // mới. Không tự động retry nếu open thất bại — lỗi ném ngược cho caller
  // (handleSubmit) xử lý, đúng tinh thần "không reconnect ngầm" đã có từ
  // trước (app.js cũ, xem docs/frontend-backend-handoff.md).
  async function ensureStream(current: Settings, token: string, sid: string) {
    if (wsSessionIdRef.current === sid && wsRef.current?.readyState === WebSocket.OPEN) return
    wsRef.current?.close()
    wsRef.current = null
    wsSessionIdRef.current = null
    await openStream(current, token, sid)
  }

  // Khởi tạo lúc mount/đăng nhập — KHÔNG mở WS (chưa có session nào để
  // subscribe, Phase 6.3), chỉ probe REST còn sống (đồng thời lấy /skills)
  // để quyết định `status`. Session/WS thật chỉ xuất hiện lúc handleSubmit()
  // gửi tin nhắn đầu tiên, hoặc lúc resumeSession() chọn 1 session cũ.
  function initSession(current: Settings, token: string) {
    setStatus('connecting')
    fetch(`${current.restUrl}/skills`, { headers: { authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ skills: SkillOption[] }>
      })
      .then((payload) => {
        setSkills(payload.skills)
        setStatus('connected')
      })
      .catch(() => {
        setSkills([])
        setStatus('disconnected')
      })
    wsRef.current?.close()
    wsRef.current = null
    wsSessionIdRef.current = null
    setSessionId(null)
    activeToolItemIdRef.current = null
    pendingSessionDriverRef.current = 'default'
  }

  function applyStep(step: LoopStep) {
    // Follow-up (2026-08): stream nội dung "gõ từng chữ" — chưa có bubble
    // đang stream thì tạo mới (bubble xuất hiện ngay ở token đầu tiên, không
    // đợi cả câu xong), có rồi thì ghép nối tiếp vào ĐÚNG bubble đó.
    if (step.type === 'token') {
      const delta = step.content ?? ''
      if (!delta) return
      const streamingId = streamingAssistantIdRef.current
      if (streamingId) {
        setItems((prev) => prev.map((it) => (it.kind === 'assistant' && it.id === streamingId ? { ...it, text: it.text + delta } : it)))
      } else {
        const id = genId()
        streamingAssistantIdRef.current = id
        setStreamingItemId(id)
        setItems((prev) => [...prev, { kind: 'assistant', id, text: delta, ts: Date.now() }])
      }
      return
    }
    if (step.type === 'model_message') {
      if (step.toolCall) {
        // Đóng bubble đang stream (nếu có — model có thể "nói" 1 đoạn ngắn
        // trước khi gọi tool) trước khi thêm tool card ngay bên dưới nó.
        streamingAssistantIdRef.current = null
        setStreamingItemId(null)
        const id = genId()
        activeToolItemIdRef.current = id
        setItems((prev) => [...prev, { kind: 'tool', id, toolCall: step.toolCall!, toolUi: step.toolUi, state: 'running' }])
      }
      // model_message KHÔNG có toolCall = nội dung sẽ trùng với step 'final'
      // ngay sau đó — không render lặp (đúng hành vi app.js cũ). Cố tình
      // KHÔNG reset streamingAssistantIdRef ở nhánh này — 'final' ngay sau
      // đây cần thấy ref còn set để biết bubble đã hiện đủ qua token rồi.
      return
    }
    // loop-rlm phát riêng 'tool_call' (name/args tách khỏi step, xem chú
    // thích ở khai báo LoopStep) — tạo đúng card "đang chạy" NGAY LÚC model
    // quyết định gọi tool, để 'tool_result' theo sau tìm được đúng tool đang
    // active mà hoàn tất (trước đây bị rơi hoàn toàn, user không thấy gì).
    if (step.type === 'tool_call') {
      const id = genId()
      activeToolItemIdRef.current = id
      setItems((prev) => [
        ...prev,
        { kind: 'tool', id, toolCall: { name: step.name ?? '', args: step.args ?? {} }, toolUi: step.toolUi, state: 'running' },
      ])
      return
    }
    // Hoạt động REPL của RLM giữa các tool call — chỉ báo đang chạy, KHÔNG
    // dán nguyên code Python vào bubble chat (không phải nơi hiển thị code
    // phù hợp, dễ rối mắt với đoạn dài) — cho cảm giác "đang làm gì" liên
    // tục thay vì màn hình trắng chờ tới 'final'.
    if (step.type === 'code') {
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), text: '💻 đang chạy code…', ts: Date.now() }])
      return
    }
    if (step.type === 'tool_result') {
      const activeId = activeToolItemIdRef.current
      activeToolItemIdRef.current = null
      if (!activeId) return // không mong đợi, không để hỏng cả UI vì 1 lệch pha (đúng app.js cũ)
      const result = step.result as { error?: string } | undefined
      const errorText = result && typeof result.error === 'string' ? result.error : undefined
      setItems((prev) =>
        prev.map((it) =>
          it.kind === 'tool' && it.id === activeId
            ? { ...it, state: errorText ? 'error' : 'ok', result: step.result, errorText }
            : it,
        ),
      )
      return
    }
    if (step.type === 'critic_message') {
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), text: '🔍 Rà soát', description: step.content, ts: Date.now() }])
      return
    }
    if (step.type === 'final') {
      // Provider hỗ trợ streaming: nội dung đã hiện đủ qua các step 'token'
      // rồi (ref còn set từ model_message không toolCall ngay trước đó) —
      // chỉ cần đóng lại, KHÔNG tạo bubble mới (tránh lặp nguyên câu trả lời).
      if (streamingAssistantIdRef.current) {
        streamingAssistantIdRef.current = null
        setStreamingItemId(null)
        return
      }
      // Provider không hỗ trợ streaming (hoặc fake LLM trong test) — hành vi
      // cũ: 'final' là nơi DUY NHẤT tạo bubble assistant.
      setItems((prev) => [...prev, { kind: 'assistant', id: genId(), text: step.content ?? '', ts: Date.now() }])
      return
    }
    if (step.type === 'analysis' && step.content) {
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), text: '🧠 Think', description: step.content }])
      return
    }
    if (step.type === 'skill_loaded') {
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), text: '📚 Skill', description: `Đọc ${step.skill ?? 'unknown'} để áp dụng hướng dẫn chuyên môn.` }])
      return
    }
    if (step.type === 'skill_resource') {
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), text: '📚 Skill resource', description: `Đọc ${step.skill ?? 'unknown'}${step.path ? `/${step.path}` : ''}.` }])
      return
    }
    if (step.type === 'workspace_read') {
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), ...workspaceReadActivity(step) }])
      return
    }
    if (step.type === 'workspace_write') {
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), ...workspaceWriteActivity(step.path) }])
      return
    }
    if (step.type === 'human_decision') {
      setItems((prev) => [...prev, humanControlItem(step)])
      return
    }
    if (step.type === 'error') {
      setItems((prev) => [...prev, { kind: 'error', id: genId(), text: `Lỗi RLM: ${step.message ?? 'không xác định'}` }])
    }
  }

  function startNewChat(driver: 'default' | 'rlm' = 'default') {
    wsRef.current?.close()
    wsRef.current = null
    wsSessionIdRef.current = null
    activeToolItemIdRef.current = null
    sessionIdRef.current = null
    // Driver là lựa chọn UI đã biết ngay khi user bấm "Chat mới" hoặc
    // "Phân tích dữ liệu"; không được đợi `session_created` mới cập nhật.
    // Session creation bị trì hoãn tới tin nhắn/upload đầu tiên, còn slot
    // workspace + skill selector phải hiện ngay để user có thể upload trước.
    setSessionDriver(driver)
    setWorkspaceFiles([])
    setWorkspaceDatasets([])
    setWorkspaceArtifacts([])
    setProjectOutputs([])
    setWorkspaceError('')
    setUploadState(null)
    setItems([])
    setProjectView(false)
    if (driver !== 'rlm') setActiveProjectId(null)
    setSessionId(null)
    pendingSessionDriverRef.current = driver
    setStatus('connected')
  }

  async function loadProjects() {
    if (!auth) return
    setProjectsLoading(true)
    try {
      const response = await fetch(`${settings.restUrl}/projects`, { headers: { authorization: `Bearer ${auth.token}` } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as { projects?: ProjectSummary[] }
      setProjects(payload.projects ?? [])
    } catch (error) {
      pushToast(`Không tải được dự án: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setProjectsLoading(false)
    }
  }

  function openProjects(projectId?: string) {
    wsRef.current?.close()
    wsRef.current = null
    setProjectView(true)
    setActiveProjectId(projectId ?? null)
    setSessionId(null)
    setItems([])
    setSessionDriver('rlm')
    setWorkspaceFiles([])
    setWorkspaceDatasets([])
    setWorkspaceArtifacts([])
    setProjectOutputs([])
    setUploadState(null)
    void loadProjects()
    if (projectId) void refreshWorkspaceFiles('', projectId)
  }

  async function createProject(name: string) {
    if (!auth) return
    const response = await fetch(`${settings.restUrl}/projects`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) {
      pushToast(`Không tạo được dự án: ${await response.text()}`, 'error')
      return
    }
    const { project } = await response.json() as { project: ProjectSummary }
    setProjects((previous) => [project, ...previous])
    setActiveProjectId(project.id)
    await refreshWorkspaceFiles('', project.id)
  }

  async function startProjectConversation(initialMessage?: string) {
    if (!auth || !activeProjectId) return
    const response = await fetch(`${settings.restUrl}/projects/${activeProjectId}/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) {
      pushToast(`Không tạo được đoạn chat: ${await response.text()}`, 'error')
      return
    }
    const created = await response.json() as { id: string; projectId: string }
    const title = initialMessage ? cacheSessionTitle(created.id, initialMessage) : 'Đoạn chat mới'
    const summary: SessionSummary = {
      id: created.id, driver: 'rlm', projectId: created.projectId,
      title, createdAt: Date.now(),
    }
    setSessions((previous) => [summary, ...previous])
    titledSessionIdsRef.current.add(created.id)
    setProjectView(false)
    setSessionDriver('rlm')
    setSessionId(created.id)
    sessionIdRef.current = created.id
    setItems(initialMessage ? [{ kind: 'user', id: genId(), text: initialMessage, ts: Date.now() }] : [])
    await ensureStream(settings, auth.token, created.id)
    if (initialMessage) {
      setTurnInFlight(true)
      try {
        const messageResponse = await fetch(`${settings.restUrl}/sessions/${created.id}/messages`, {
          method: 'POST',
          headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message: initialMessage, selectedSkill: selectedSkill || undefined }),
        })
        if (!messageResponse.ok) throw new Error(await messageResponse.text())
      } catch (error) {
        setTurnInFlight(false)
        pushToast(`Gửi tin nhắn thất bại: ${error instanceof Error ? error.message : String(error)}`, 'error')
      }
    }
    await refreshWorkspaceFiles(created.id, created.projectId)
  }

  // Dựng lại ChatItem[] từ event log THẬT (GET /sessions/:id/events) — khác
  // applyStep() (xử lý TỪNG step LIVE qua WS), hàm này đọc 1 MẢNG event lưu
  // sẵn. 2 khác biệt quan trọng so với step LIVE: (1) 'user_message' (mới
  // thêm) CÓ mặt ở đây — cần render thành bubble user, LIVE thì client tự
  // thêm ngay lúc gửi, không cần step riêng; (2) KHÔNG có 'final' — model_
  // message không kèm toolCall CHÍNH LÀ câu trả lời cuối (final không lưu
  // storage riêng, xem coding rule B3/ghi chú loop-default).
  function reconstructItems(events: LoopStep[]): ChatItem[] {
    const result: ChatItem[] = []
    let pendingToolId: string | null = null

    for (const raw of events) {
      const step = raw as LoopStep & { type: string }
      if (step.type === 'user_message') {
        let pendingControl = -1
        for (let index = result.length - 1; index >= 0; index -= 1) {
          const item = result[index]
          if (item.kind === 'control' && !item.answered) {
            pendingControl = index
            break
          }
        }
        if (pendingControl !== -1) {
          const item = result[pendingControl] as Extract<ChatItem, { kind: 'control' }>
          result[pendingControl] = { ...item, answered: step.content ?? '' }
        }
        result.push({ kind: 'user', id: genId(), text: step.content ?? '' })
        continue
      }
      if (step.type === 'model_message') {
        if (step.toolCall) {
          const id = genId()
          pendingToolId = id
          result.push({ kind: 'tool', id, toolCall: step.toolCall, toolUi: step.toolUi, state: 'running' })
        } else {
          result.push({ kind: 'assistant', id: genId(), text: step.content ?? '' })
        }
        continue
      }
      // Cùng gap đã sửa ở applyStep() (xem chú thích khai báo LoopStep):
      // loop-rlm lưu 'tool_call' RIÊNG (name/args tách khỏi step), khác
      // model_message của loop-default — thiếu nhánh này khiến resume 1
      // session RLM cũ mất sạch card tool, khác hẳn xem live qua WS.
      if (step.type === 'tool_call') {
        const id = genId()
        pendingToolId = id
        result.push({ kind: 'tool', id, toolCall: { name: step.name ?? '', args: step.args ?? {} }, toolUi: step.toolUi, state: 'running' })
        continue
      }
      if (step.type === 'code') {
        result.push({ kind: 'critic', id: genId(), text: '💻 đang chạy code…' })
        continue
      }
      if (step.type === 'tool_result' && pendingToolId) {
        const id = pendingToolId
        pendingToolId = null
        const r = step.result as { error?: string } | undefined
        const errorText = r && typeof r.error === 'string' ? r.error : undefined
        const idx = result.findIndex((it) => it.id === id)
        if (idx !== -1) {
          result[idx] = { ...(result[idx] as Extract<ChatItem, { kind: 'tool' }>), state: errorText ? 'error' : 'ok', result: step.result, errorText }
        }
        continue
      }
      if (step.type === 'critic_message') {
        result.push({ kind: 'critic', id: genId(), text: '🔍 Rà soát', description: step.content })
        continue
      }
      if (step.type === 'analysis' && step.content) {
        result.push({ kind: 'critic', id: genId(), text: '🧠 Think', description: step.content })
        continue
      }
      if (step.type === 'skill_loaded') {
        result.push({ kind: 'critic', id: genId(), text: '📚 Skill', description: `Đọc ${step.skill ?? 'unknown'} để áp dụng hướng dẫn chuyên môn.` })
        continue
      }
      if (step.type === 'skill_resource') {
        result.push({ kind: 'critic', id: genId(), text: '📚 Skill resource', description: `Đọc ${step.skill ?? 'unknown'}${step.path ? `/${step.path}` : ''}.` })
        continue
      }
      if (step.type === 'workspace_read') {
        result.push({ kind: 'critic', id: genId(), ...workspaceReadActivity(step) })
        continue
      }
      if (step.type === 'workspace_write') {
        result.push({ kind: 'critic', id: genId(), ...workspaceWriteActivity(step.path) })
        continue
      }
      if (step.type === 'final_answer') {
        result.push({ kind: 'assistant', id: genId(), text: step.content ?? '' })
        continue
      }
      if (step.type === 'human_decision') {
        result.push(humanControlItem(step))
        continue
      }
      if (step.type === 'error') {
        result.push({ kind: 'error', id: genId(), text: `Lỗi RLM: ${step.message ?? 'không xác định'}` })
      }
    }
    return result
  }

  // Chuyển sang 1 session CŨ (click trong Sidebar) — tải lại lịch sử thật
  // qua REST, rồi mở WS subscribe cho ĐÚNG session đó (Phase 6.3: session đã
  // tồn tại server-side, không cần "tạo lại" — chỉ cần mở downlink).
  async function resumeSession(id: string) {
    if (id === sessionId || !auth) return
    // docs/agent-core-rlm-web-ui-plugin-plan.md mục 1: driver của session cũ
    // đã có sẵn trong `sessions` (GET /sessions trả đúng field này) — không
    // cần gọi thêm API riêng chỉ để biết driver.
    const selected = sessions.find((s) => s.id === id)
    const driver = selected?.driver ?? 'default'
    const projectId = selected?.projectId
    setProjectView(false)
    setActiveProjectId(projectId ?? null)
    setSessionDriver(driver)
    if (driver === 'rlm') refreshWorkspaceFiles(id, projectId)
    try {
      let events: LoopStep[]
      try {
        events = await fetchSessionEvents(settings.restUrl, auth.token, id)
      } catch (error) {
        const status = error instanceof Error ? error.message : ''
        pushToast(
          status === 'HTTP 404' ? 'Cuộc trò chuyện này đã hết hạn hoặc không còn tồn tại.' : `Không tải được lịch sử (${status || 'lỗi không xác định'}).`,
          'error',
        )
        return
      }
      wsRef.current?.close()
      wsRef.current = null
      wsSessionIdRef.current = null
      activeToolItemIdRef.current = null
      setItems(reconstructItems(events))
      rememberActiveSession(auth.user.id, id)
      titledSessionIdsRef.current.add(id) // đã có lịch sử thật -> không ghi đè title bằng tin nhắn tiếp theo
      setSessionId(id)
      sessionIdRef.current = id
      await ensureStream(settings, auth.token, id)
    } catch {
      pushToast('Không thể tải lại cuộc trò chuyện này — kiểm tra kết nối.', 'error')
    }
  }

  // Module auth: kết nối + tải lịch sử CHỈ khi đã đăng nhập — mọi hook vẫn
  // gọi KHÔNG ĐIỀU KIỆN mỗi render (React rules of hooks), chỉ THÂN effect
  // này gate theo `auth`. Đăng xuất (auth chuyển null) PHẢI dọn sạch state
  // NGAY trong nhánh else — không để 1 người đăng nhập sau, trên CÙNG
  // trình duyệt, thấy sót state của người đăng nhập trước đó.
  useEffect(() => {
    if (!auth) {
      wsRef.current?.close()
      wsRef.current = null
      wsSessionIdRef.current = null
      setSessions([])
      setProjects([])
      setItems([])
      setSessionId(null)
      setStatus('connecting')
      return
    }
    let disposed = false
    initSession(settings, auth.token)
    void fetchSessionHistory(settings.restUrl, auth.token)
      .then(async (history) => {
        if (disposed) return
        setSessions(history)
        void loadProjects()
        const rememberedId = activeSessionId(auth.user.id)
        const target = history.find((session) => session.id === rememberedId) ?? history[0]
        if (!target) return
        try {
          const events = await fetchSessionEvents(settings.restUrl, auth.token, target.id)
          if (disposed) return
          setSessionDriver(target.driver)
          setActiveProjectId(target.projectId ?? null)
          setItems(reconstructItems(events))
          titledSessionIdsRef.current.add(target.id)
          rememberActiveSession(auth.user.id, target.id)
          if (target.driver === 'rlm') refreshWorkspaceFiles(target.id, target.projectId)
          setSessionId(target.id)
          sessionIdRef.current = target.id
          await ensureStream(settings, auth.token, target.id)
        } catch {
          if (!disposed) setStatus('connected')
        }
      })
      .catch(() => {
        if (disposed) return
        pushToast('Không tải được danh sách cuộc trò chuyện.', 'error')
        setStatus('connected')
      })
    return () => {
      disposed = true
      const socket = wsRef.current
      wsRef.current = null
      socket?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth])

  async function sendUserMessage(rawText: string, controlItemId?: string): Promise<boolean> {
    const text = rawText.trim()
    if (!text || turnInFlight || !auth || status !== 'connected') return false

    setItems((prev) => [
      ...prev.map((item) =>
        controlItemId && item.kind === 'control' && item.id === controlItemId ? { ...item, answered: text } : item,
      ),
      { kind: 'user' as const, id: genId(), text, ts: Date.now() },
    ])
    setComposerText('')
    setTurnInFlight(true)

    try {
      let sid = sessionId
      if (!sid) {
        // Chưa từng gửi tin nào trong chat này -> chưa có session server-side
        // nào cả (tạo session bị hoãn tới đúng đây, xem pendingSessionDriverRef).
        const createRes = await fetch(`${settings.restUrl}/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ driver: pendingSessionDriverRef.current }),
        })
        if (!createRes.ok) throw new Error(await createRes.text())
        const created = (await createRes.json()) as { id: string; driver: string }
        sid = created.id
        setSessionId(sid)
        sessionIdRef.current = sid
        setSessionDriver(created.driver)
        const title = cacheSessionTitle(sid, text)
        titledSessionIdsRef.current.add(sid)
        // Thêm optimistic lên ĐẦU list — server đã gắn ownerId thật lúc tạo
        // (identity từ chính token đã verify), lần fetch GET /sessions tiếp
        // theo sẽ thấy đúng session này; thêm ngay ở đây để UI phản hồi tức
        // thời, không đợi round-trip fetch lại.
        setSessions((prev) => [{ id: sid as string, createdAt: Date.now(), title, driver: created.driver }, ...prev])
        if (created.driver === 'rlm') refreshWorkspaceFiles(sid, activeProjectId ?? undefined)
      } else if (!titledSessionIdsRef.current.has(sid)) {
        // Chỉ đặt title 1 LẦN cho câu hỏi ĐẦU TIÊN của session (Set tránh ghi
        // đè bằng câu hỏi sau, và tránh ghi đè session đã resume có title thật).
        titledSessionIdsRef.current.add(sid)
        const title = cacheSessionTitle(sid, text)
        setSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, title } : s)))
      }

      // Mở stream TRƯỚC khi gửi message — server emit step ĐỒNG BỘ trong lúc
      // xử lý runTurn, phải subscribe xong mới không lỡ step đầu tiên (xem
      // openStream() và seams/loop.ts).
      await ensureStream(settings, auth.token, sid)

      const msgRes = await fetch(`${settings.restUrl}/sessions/${sid}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, selectedSkill: selectedSkill || undefined }),
      })
      if (!msgRes.ok) throw new Error(await msgRes.text())
      // Không xử lý lại nội dung response ở đây — WS 'done' đã/sẽ render kết
      // quả (xem openStream). Chỉ dùng việc POST resolve xong làm lưới an
      // toàn tắt turnInFlight nếu vì lý do gì đó WS bị rớt đúng lúc 'done'
      // phát ra (idempotent với setTurnInFlight(false) trong handler 'done').
      setTurnInFlight(false)
      return true
    } catch (e: unknown) {
      setTurnInFlight(false)
      pushToast(`Gửi tin nhắn thất bại: ${e instanceof Error ? e.message : String(e)}`, 'error')
      return false
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    void sendUserMessage(composerText)
  }

  function handleLogout() {
    wsRef.current?.close()
    wsRef.current = null
    wsSessionIdRef.current = null
    clearAuthState()
    setAuth(null)
    setAuthView('login')
  }

  // Follow-up (2026-08): trước đây chỉ báo Ở CẤP LƯỢT (WS chưa có protocol
  // token-delta) — giờ có streaming thật (xem applyStep(), step 'token'),
  // nên thêm điều kiện loại trừ MỚI: item cuối đang là bubble assistant đang
  // stream thì tự nó đã là chỉ báo "đang chạy" rồi (chữ đang gõ ra), không
  // cần thêm 1 dòng "..." chồng lên dưới. Vẫn giữ điều kiện loại trừ cũ cho
  // tool đang chạy (đã có shimmer riêng, ToolRow) và cho trường hợp provider
  // không hỗ trợ streaming (rơi về đúng hành vi cũ).
  const lastItem = items[items.length - 1]
  const showStreamingRow =
    turnInFlight &&
    !(lastItem?.kind === 'tool' && lastItem.state === 'running') &&
    !(lastItem?.kind === 'assistant' && lastItem.id === streamingAssistantIdRef.current)

  // Follow-up (2026-08): chat MỚI (chưa gõ gì) giờ hợp lệ để gõ/gửi dù
  // `sessionId` còn null (session thật chỉ tạo lúc gửi — xem handleSubmit),
  // nên composer không còn chờ sessionId nữa, chỉ cần WS đã 'connected'.
  const composerEnabled = status === 'connected' && !turnInFlight
  const datasetPaths = new Set(workspaceDatasets.flatMap((dataset) => [dataset.path, dataset.filename].filter(Boolean) as string[]))
  const artifactPaths = new Set(workspaceArtifacts)
  const workspaceEntries = [
    ...workspaceFiles,
    ...workspaceArtifacts
      .filter((artifact) => !workspaceFiles.some((file) => file.path === artifact))
      .map((artifact) => ({ path: artifact, size: 0, mtime: '' })),
  ].map((file) => ({
    ...file,
    kind: artifactPaths.has(file.path) ? 'output' as const : datasetPaths.has(file.path) || datasetPaths.has(file.path.split('/').pop() ?? '') ? 'dataset' as const : 'file' as const,
  }))
  const activeProject = projects.find((project) => project.id === activeProjectId)
  const projectConversations = sessions
    .filter((session) => session.projectId === activeProjectId)
    .map(({ id, title, createdAt }) => ({ id, title, createdAt }))

  // Module auth: chưa đăng nhập -> thay TOÀN BỘ khung chat bằng màn hình
  // đăng nhập/đăng ký — đặt SAU mọi hook (đúng rules of hooks), TRƯỚC JSX
  // chính.
  if (!auth) {
    return authView === 'login' ? (
      <LoginForm
        restUrl={settings.restUrl}
        onSuccess={(result) => {
          saveAuthState(result)
          setAuth(result)
        }}
        onSwitchToSignup={() => setAuthView('signup')}
      />
    ) : (
      <SignupForm
        restUrl={settings.restUrl}
        onSuccess={(result) => {
          saveAuthState(result)
          setAuth(result)
        }}
        onSwitchToLogin={() => setAuthView('login')}
      />
    )
  }

  return (
    <>
      <ToastContainer toasts={toasts} />
      <OutputPreviewModal
        target={outputPreview}
        token={auth.token}
        onClose={() => setOutputPreview(null)}
        onDownload={downloadPreview}
        onDelete={deletePreview}
      />
      <AppFrame
        wide={projectView}
        sidebar={
          <Sidebar
            sessions={sessions.filter((session) => !session.projectId)}
            activeSessionId={sessionId}
            onNewChat={() => startNewChat()}
            onNewDataSession={() => openProjects()}
            onSelectSession={resumeSession}
            isAdmin={auth.user.role === 'admin'}
            onOpenAdminPanel={() => setAdminPanelOpen(true)}
            onOpenPluginInventory={() => setPluginInventoryOpen(true)}
            onOpenPluginSettings={() => setPluginSettingsOpen(true)}
            currentUsername={auth.user.username}
            onLogout={handleLogout}
          />
        }
        // Follow-up (2026-08), lần 2: xoá HẲN header (trước đó chỉ bỏ tiêu đề
        // "agent-core" + số hiệu session, còn giữ tag trạng thái kết nối —
        // user yêu cầu bỏ luôn cả tag đó). AppFrame không render `<header>`
        // gì cả khi không truyền `header` (xem ghi chú AppFrameProps.header).
        // UI redesign (follow-up): workspace bar từng nhét CHUNG vào `header`
        // ở trên — nhưng `.header` (AppFrame.module.css) là flex row
        // `justify-content: space-between` DÀNH ĐÚNG cho 2 phần tử (tiêu đề +
        // trạng thái); thêm phần tử thứ 3 vào đó ép mọi thứ nằm chung 1 hàng
        // ngang với tiêu đề thay vì xuống hàng riêng — gap thị giác thật user
        // báo lại. Dùng `subHeader` (mới thêm vào AppFrame cho đúng việc
        // này) thay vì `header` — xuống hàng riêng, tách bạch khỏi tiêu đề.
        subHeader={
          !projectView && clientCtx && (
            <RenderSlot<WorkspaceHeaderPanelProps>
              ctx={clientCtx}
              name="session.chrome.header"
              entryKey={sessionDriver}
              owner={{
                uploadDisabled: status !== 'connected' && !sessionId,
                refreshDisabled: !sessionId,
                onUpload: handleFileUpload,
                onRefresh: () => sessionId && refreshWorkspaceFiles(sessionId),
                onDownload: downloadWorkspaceFile,
                onPreview: previewWorkspaceOutput,
                datasetsCount: workspaceDatasets.length,
                artifactsCount: workspaceArtifacts.length,
                loading: workspaceLoading,
                error: workspaceError,
                uploadState,
                entries: workspaceEntries,
              }}
              fallback={() => null}
            />
          )
        }
        // Follow-up (2026-08): chọn skill kiểu slash-command ("/" mở popup lọc
        // tên/mô tả) giờ nằm THẲNG trong Composer, dùng CHUNG cho mọi driver —
        // thay cho RenderSlot 'session.chrome.composer' (SkillComposerExtra,
        // dropdown riêng chỉ hiện cho entryKey='rlm' cũ) vốn khiến chat thường
        // (driver 'default') không có cách nào chọn skill dù backend đã hỗ trợ
        // sẵn (loop-default gọi resolveActiveSkills(..., input.selectedSkill)).
        footer={projectView ? null : (
          <Composer
            value={composerText}
            onChange={setComposerText}
            onSubmit={handleSubmit}
            disabled={!composerEnabled}
            skills={skills}
            selectedSkill={selectedSkill}
            onSelectSkill={setSelectedSkill}
          />
        )}
      >
        {projectView ? (
          <ProjectHub
            key={activeProjectId ?? 'project-list'}
            projects={projects}
            activeProject={activeProject}
            conversations={projectConversations}
            sources={workspaceEntries.filter((file) => file.kind !== 'output').map((file) => ({ ...file, kind: file.kind === 'dataset' ? 'dataset' as const : 'file' as const }))}
            outputs={projectOutputs}
            loading={projectsLoading || workspaceLoading}
            uploadProgress={uploadState?.phase === 'uploading' ? uploadState.progress : undefined}
            onCreateProject={createProject}
            onOpenProject={(id) => openProjects(id)}
            onBack={() => openProjects()}
            onStartConversation={startProjectConversation}
            onOpenConversation={resumeSession}
            onUpload={handleFileUpload}
            onDownloadSource={downloadWorkspaceFile}
            onPreviewOutput={previewProjectOutput}
            onPromoteOutput={promoteProjectOutput}
          />
        ) : <>
        {items.length === 0 && <EmptyState />}
        {items.map((item) => {
          if (item.kind === 'control') {
            return (
              <HumanDecision
                key={item.id}
                question={item.question}
                options={item.options}
                reason={item.reason}
                answered={item.answered}
                disabled={!composerEnabled}
                onAnswer={(answer) => sendUserMessage(answer, item.id)}
              />
            )
          }
          if (item.kind === 'tool') {
            const owner: ToolViewOwnerProps = { toolCall: item.toolCall, result: item.result, state: item.state, toolUi: item.toolUi }
            return (
              <ToolRow
                key={item.id}
                icon={item.toolUi?.icon ?? '🔧'}
                title={item.toolUi?.label ?? item.toolCall.name}
                summary={toolRowSummary(item)}
                state={item.state}
                // Follow-up (2026-08): kết quả search (citations) hiện NGAY
                // khi xong, không cần bấm — user báo trước đây bị ẩn mất.
                defaultExpanded={item.toolUi?.render === 'citations'}
              >
                {item.state === 'ok' && clientCtx && (
                  <RenderSlot<ToolViewOwnerProps>
                    ctx={clientCtx}
                    name="tool.call.toolview"
                    entryKey={item.toolCall.name}
                    owner={owner}
                    fallback={GenericToolCard}
                  />
                )}
              </ToolRow>
            )
          }
          return (
            <MessageBubble
              key={item.id}
              kind={item.kind}
              text={item.text}
              description={item.description}
              ts={item.ts}
              streaming={item.kind === 'assistant' && item.id === streamingItemId}
              onCopied={() => pushToast('Đã sao chép')}
            />
          )
        })}
        {showStreamingRow && <StreamingRow />}
        <div ref={messagesEndRef} />
        </>}
      </AppFrame>

      <AdminUsersPanel
        open={adminPanelOpen}
        onClose={() => setAdminPanelOpen(false)}
        restUrl={settings.restUrl}
        token={auth.token}
        currentUserId={auth.user.id}
      />

      <PluginInventoryPanel
        open={pluginInventoryOpen}
        onClose={() => setPluginInventoryOpen(false)}
        restUrl={settings.restUrl}
        token={auth.token}
      />

      <PluginSettingsPanel
        open={pluginSettingsOpen}
        onClose={() => setPluginSettingsOpen(false)}
        restUrl={settings.restUrl}
        token={auth.token}
      />
    </>
  )
}
