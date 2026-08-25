// apps/web/src/App.tsx — Phase 9.4: cây component chính, thay renderStep()/
// addMessage() thủ công trong app.js cũ (Phase 7/8.5) bằng state React. Giao
// thức REST/WS giữ NGUYÊN (không đổi API backend) — chỉ đổi cách render phía
// client. `clientCtx` (cây Cordis riêng chạy trong trình duyệt, Phase 9.4)
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
import type { WorkspaceHeaderPanelProps, SkillComposerExtraProps } from '@agent-core/ui-rlm-workspace'
import { createClientContext } from './client-context.ts'

type ToolUiHint = ToolViewOwnerProps['toolUi']

interface LoopStep {
  // 'user_message' KHÔNG bao giờ đến qua step LIVE (agent/step) — chỉ xuất
  // hiện khi đọc lại event log THẬT qua GET /sessions/:id/events (xem
  // reconstructItems()). Gộp chung interface để dùng lại 1 type cho cả 2
  // nguồn (LoopStep từ WS 'step' và StoredEvent từ REST), tránh 2 kiểu dữ
  // liệu gần giống nhau song song.
  type:
    | 'user_message'
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

// docs/agent-core-rlm-web-ui-plugin-plan.md mục 3: mặc định quay về
// 'default' (chat thường) — RLM không còn là driver CỐ ĐỊNH cho MỌI
// session nữa, chỉ tạo khi user chủ động bấm "Phân tích dữ liệu"
// (Sidebar.onNewDataSession).
export function createSessionCommand(driver: 'default' | 'rlm' = 'default') {
  return {
    type: 'create_session',
    driver,
  }
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
  const [skills, setSkills] = useState<SkillOption[]>([])
  const [selectedSkill, setSelectedSkill] = useState('')
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [workspaceDatasets, setWorkspaceDatasets] = useState<WorkspaceDataset[]>([])
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<string[]>([])
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [uploadState, setUploadState] = useState<UploadState | null>(null)

  const { toasts, push: pushToast } = useToasts()

  async function refreshWorkspaceFiles(sid: string) {
    // Module auth: `Settings` không còn `apiKey` (Phase 24) — danh tính là
    // `auth.token`. Hàm này chỉ thực sự được gọi từ chỗ đã qua gate `!auth`
    // (WS handler trong connect()/resumeSession, hoặc nút bấm trong JSX sau
    // gate) nhưng là function declaration riêng, TS không tự narrow qua
    // ranh giới hàm — guard tường minh.
    if (!auth) return
    setWorkspaceLoading(true)
    try {
      const res = await fetch(`${settings.restUrl}/sessions/${sid}/files`, { headers: { authorization: `Bearer ${auth.token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const data = (await res.json()) as { files: WorkspaceFile[]; datasets: WorkspaceDataset[]; artifacts: string[] }
      setWorkspaceFiles(data.files ?? [])
      setWorkspaceDatasets(data.datasets ?? [])
      setWorkspaceArtifacts(data.artifacts ?? [])
      setWorkspaceError('')
    } catch (error: unknown) {
      setWorkspaceError(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkspaceLoading(false)
    }
  }

  // docs/agent-core-rlm-web-ui-plugin-plan.md mục 2: nhận thẳng 1 File —
  // <input type="file"> giờ nằm TRONG WorkspaceHeaderPanel (ui-rlm-workspace),
  // App.tsx không còn sở hữu DOM input đó nữa, chỉ còn phần gọi API thật.
  async function handleFileUpload(file: File) {
    if (!auth) return
    let sid = sessionId
    if (!sid) {
      // Tự tạo session nếu chưa có (nhánh phòng thủ hiếm gặp — workspace bar
      // chỉ hiện cho session driver 'rlm' đã tồn tại, xem mục 3; vẫn giữ vì
      // race window hẹp giữa lúc bấm "Phân tích dữ liệu" và session_created
      // WS trả về).
      try {
        const res = await fetch(`${settings.restUrl}/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ driver: 'rlm' }),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = (await res.json()) as { id: string }
        sid = data.id
        setSessionId(sid)
        sessionIdRef.current = sid
        setStatus('connected')
      } catch (e: unknown) {
        pushToast(`Không tạo được session: ${e instanceof Error ? e.message : String(e)}`, 'error')
        return
      }
    }
    if (file.size > 70 * 1024 * 1024) { pushToast('File quá lớn (tối đa 70 MiB).', 'error'); return }
    setUploadState({ phase: 'uploading', filename: file.name, progress: 0 })
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${settings.restUrl}/sessions/${sid}/files`)
        xhr.setRequestHeader('authorization', `Bearer ${auth.token}`)
        xhr.setRequestHeader('content-type', 'application/octet-stream')
        xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadState({ phase: 'uploading', filename: file.name, progress: Math.round((e.loaded / e.total) * 100) })
          }
        }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || `HTTP ${xhr.status}`)))
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.send(file)
      })
      await refreshWorkspaceFiles(sid)
      setUploadState({ phase: 'success', filename: file.name, progress: 100, message: 'Đã upload và đăng ký trong workspace.' })
      pushToast(`Đã tải lên ${file.name}`, 'default')
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setUploadState({ phase: 'error', filename: file.name, progress: 0, message })
      pushToast(`Upload thất bại: ${message}`, 'error')
    }
  }

  async function downloadWorkspaceFile(filePath: string) {
    if (!sessionId || !auth) return
    try {
      const response = await fetch(`${settings.restUrl}/sessions/${sessionId}/files/${encodeURIComponent(filePath)}`, {
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

  const wsRef = useRef<WebSocket | null>(null)
  const activeToolItemIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  // Session hiện tại đã có tin nhắn user đầu tiên chưa — chỉ cập nhật title
  // lịch sử ĐÚNG 1 LẦN cho câu hỏi đầu tiên, không ghi đè bằng câu hỏi sau.
  const titledSessionIdsRef = useRef<Set<string>>(new Set())
  // Follow-up (2026-08): bug thật user báo — mở app hoặc bấm "Chat mới" rồi
  // KHÔNG gõ gì, F5 lại thấy 1 session rỗng tự lưu vào history. Nguyên nhân:
  // create_session cũ gửi NGAY lúc WS mở (connect()), nên server đã có 1
  // session thật (GET /sessions trả về) dù chưa hề có tin nhắn nào. Sửa:
  // hoãn create_session tới đúng lúc handleSubmit() gửi tin nhắn ĐẦU TIÊN —
  // 2 ref dưới đây giữ tạm dữ liệu cần trong lúc chờ session_created trả về.
  const pendingFirstMessageRef = useRef<{ text: string; skill?: string } | null>(null)
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
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [items])

  // `resumeSessionId`: khi có, KHÔNG gửi 'create_session' — session đó ĐÃ
  // tồn tại server-side (miễn còn trong TTL trượt của session-registry, xem
  // Phase 8.1). WS protocol không có message riêng "resume" — `send_message`
  // chấp nhận BẤT KỲ sessionId hợp lệ nào, không quan tâm nó được tạo qua
  // kết nối WS nào, nên chỉ cần bỏ qua bước create_session là đủ.
  // `newSessionDriver` (docs/agent-core-rlm-web-ui-plugin-plan.md mục 3):
  // CHỈ dùng lúc tạo session MỚI (bỏ qua khi resume — driver của session cũ
  // do server quyết định từ lúc tạo, không đổi được).
  function connect(current: Settings, token: string, resumeSessionId?: string, newSessionDriver: 'default' | 'rlm' = 'default') {
    setStatus('connecting')
    void fetch(`${current.restUrl}/skills`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ skills: SkillOption[] }>
      })
      .then((payload) => setSkills(payload.skills))
      .catch(() => setSkills([]))
    setSessionId(resumeSessionId ?? null)
    sessionIdRef.current = resumeSessionId ?? null
    activeToolItemIdRef.current = null
    pendingFirstMessageRef.current = null
    pendingSessionDriverRef.current = newSessionDriver

    const url = `${current.wsUrl}/?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    // Follow-up (2026-08): KHÔNG còn gửi create_session ngay lúc mở WS cho
    // chat MỚI nữa (xem ghi chú pendingFirstMessageRef ở khai báo ref) —
    // session thật chỉ tạo lúc handleSubmit() gửi tin nhắn đầu tiên. Ở đây
    // chỉ cần đánh dấu đã kết nối (đúng cho cả 2 trường hợp resume/mới).
    ws.addEventListener('open', () => {
      if (wsRef.current !== ws) return
      setStatus('connected')
    })

    ws.addEventListener('message', (event) => {
      if (wsRef.current !== ws) return
      const msg = JSON.parse(event.data)

      if (msg.type === 'session_created') {
        setSessionId(msg.id)
        sessionIdRef.current = msg.id
        if (auth) rememberActiveSession(auth.user.id, msg.id)
        setSessionDriver(msg.driver)
        setStatus('connected')
        // Follow-up (2026-08): create_session giờ CHỈ gửi từ handleSubmit()
        // lúc có tin nhắn đầu tiên thật đang chờ (pendingFirstMessageRef) —
        // session vừa tạo LUÔN sắp có nội dung thật ngay sau đây, không còn
        // ca "tạo xong rồi bỏ đó" nữa (không còn cần bubble hệ thống báo
        // "Session mới: <id>" — cũng đúng tinh thần bỏ số hiệu session khỏi
        // UI, xem header bên dưới). Tính title thật ngay ở đây thay vì
        // "Cuộc trò chuyện mới" tạm rồi ghi đè sau, chỉ setSessions() 1 lần.
        const pending = pendingFirstMessageRef.current
        const title = pending ? cacheSessionTitle(msg.id, pending.text) : 'Cuộc trò chuyện mới'
        if (pending) titledSessionIdsRef.current.add(msg.id)
        // Thêm optimistic lên ĐẦU list — server đã gắn ownerId thật lúc tạo
        // (create_session qua WS truyền identity đã verify), lần fetch
        // GET /sessions tiếp theo sẽ thấy đúng session này; thêm ngay ở đây
        // để UI phản hồi tức thời, không đợi round-trip fetch lại.
        setSessions((prev) => [{ id: msg.id, createdAt: Date.now(), title, driver: msg.driver }, ...prev])
        if (msg.driver === 'rlm') refreshWorkspaceFiles(msg.id)
        if (pending) {
          pendingFirstMessageRef.current = null
          ws.send(JSON.stringify({ type: 'send_message', sessionId: msg.id, message: pending.text, selectedSkill: pending.skill }))
        }
        return
      }

      if (msg.type === 'step') {
        applyStep(msg.step as LoopStep)
        return
      }

      if (msg.type === 'done') {
        setTurnInFlight(false)
        const sid = sessionIdRef.current ?? (msg as { sessionId?: string }).sessionId
        if (sid) {
          const completedSessionId = String(sid)
          refreshWorkspaceFiles(completedSessionId)
        }
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
      if (wsRef.current !== ws) return
      setStatus('disconnected')
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
    })

    ws.addEventListener('error', () => {
      if (wsRef.current !== ws) return
      setStatus('disconnected')
    })
  }

  function applyStep(step: LoopStep) {
    if (step.type === 'model_message') {
      if (step.toolCall) {
        const id = genId()
        activeToolItemIdRef.current = id
        setItems((prev) => [...prev, { kind: 'tool', id, toolCall: step.toolCall!, toolUi: step.toolUi, state: 'running' }])
      }
      // model_message KHÔNG có toolCall = nội dung sẽ trùng với step 'final'
      // ngay sau đó — không render lặp (đúng hành vi app.js cũ).
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

  function startNewChat(current: Settings, token: string, driver: 'default' | 'rlm' = 'default') {
    wsRef.current?.close()
    wsRef.current = null
    activeToolItemIdRef.current = null
    sessionIdRef.current = null
    setItems([])
    connect(current, token, undefined, driver)
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
  // qua REST (KHÔNG phải WS, vốn không có message "resume"), rồi mở kết nối
  // WS mới bỏ qua create_session (session đã tồn tại server-side).
  async function resumeSession(id: string) {
    if (id === sessionId || !auth) return
    // docs/agent-core-rlm-web-ui-plugin-plan.md mục 1: driver của session cũ
    // đã có sẵn trong `sessions` (GET /sessions trả đúng field này) — không
    // cần gọi thêm API riêng chỉ để biết driver.
    const driver = sessions.find((s) => s.id === id)?.driver ?? 'default'
    setSessionDriver(driver)
    if (driver === 'rlm') refreshWorkspaceFiles(id)
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
      activeToolItemIdRef.current = null
      setItems(reconstructItems(events))
      rememberActiveSession(auth.user.id, id)
      titledSessionIdsRef.current.add(id) // đã có lịch sử thật -> không ghi đè title bằng tin nhắn tiếp theo
      connect(settings, auth.token, id)
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
      setSessions([])
      setItems([])
      setSessionId(null)
      setStatus('connecting')
      return
    }
    let disposed = false
    void fetchSessionHistory(settings.restUrl, auth.token)
      .then(async (history) => {
        if (disposed) return
        setSessions(history)
        const rememberedId = activeSessionId(auth.user.id)
        const target = history.find((session) => session.id === rememberedId) ?? history[0]
        if (!target) {
          connect(settings, auth.token)
          return
        }
        try {
          const events = await fetchSessionEvents(settings.restUrl, auth.token, target.id)
          if (disposed) return
          setSessionDriver(target.driver)
          setItems(reconstructItems(events))
          titledSessionIdsRef.current.add(target.id)
          rememberActiveSession(auth.user.id, target.id)
          if (target.driver === 'rlm') refreshWorkspaceFiles(target.id)
          connect(settings, auth.token, target.id)
        } catch {
          if (!disposed) connect(settings, auth.token)
        }
      })
      .catch(() => {
        if (disposed) return
        pushToast('Không tải được danh sách cuộc trò chuyện.', 'error')
        connect(settings, auth.token)
      })
    return () => {
      disposed = true
      const socket = wsRef.current
      wsRef.current = null
      socket?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth])

  function sendUserMessage(rawText: string, controlItemId?: string) {
    const text = rawText.trim()
    const ws = wsRef.current
    if (!text || turnInFlight || !ws || ws.readyState !== WebSocket.OPEN) return false

    setItems((prev) => [
      ...prev.map((item) =>
        controlItemId && item.kind === 'control' && item.id === controlItemId ? { ...item, answered: text } : item,
      ),
      { kind: 'user' as const, id: genId(), text, ts: Date.now() },
    ])
    setComposerText('')
    setTurnInFlight(true)

    if (!sessionId) {
      // Chưa từng gửi tin nào trong chat này -> chưa có session server-side
      // nào cả (create_session bị hoãn tới đúng đây — xem connect() và
      // session_created handler). Nhớ tạm tin nhắn, gửi create_session;
      // session_created handler sẽ tự gửi tiếp send_message khi có id thật.
      pendingFirstMessageRef.current = { text, skill: selectedSkill || undefined }
      ws.send(JSON.stringify(createSessionCommand(pendingSessionDriverRef.current)))
      return true
    }

    // Chỉ đặt title 1 LẦN cho câu hỏi ĐẦU TIÊN của session (Set tránh ghi đè
    // bằng câu hỏi sau, và tránh ghi đè session đã resume có title thật).
    if (!titledSessionIdsRef.current.has(sessionId)) {
      titledSessionIdsRef.current.add(sessionId)
      const title = cacheSessionTitle(sessionId, text)
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)))
    }
    ws.send(JSON.stringify({
      type: 'send_message',
      sessionId,
      message: text,
      selectedSkill: selectedSkill || undefined,
    }))
    return true
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    sendUserMessage(composerText)
  }

  function handleLogout() {
    wsRef.current?.close()
    wsRef.current = null
    clearAuthState()
    setAuth(null)
    setAuthView('login')
  }

  // Chỉ báo Ở CẤP LƯỢT (không phải gõ từng ký tự — WS không có protocol
  // token-delta, xem seams/loop.ts). Không hiện nếu item cuối ĐANG LÀ 1 tool
  // đang chạy — tool đó đã có shimmer riêng của chính nó (ToolRow), tránh 2
  // shimmer chồng nhau cho cùng 1 lượt.
  const lastItem = items[items.length - 1]
  const showStreamingRow = turnInFlight && !(lastItem?.kind === 'tool' && lastItem.state === 'running')

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
      <AppFrame
        sidebar={
          <Sidebar
            sessions={sessions}
            activeSessionId={sessionId}
            onNewChat={() => startNewChat(settings, auth.token)}
            onNewDataSession={() => startNewChat(settings, auth.token, 'rlm')}
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
          clientCtx && (
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
        footer={
          <>
            {clientCtx && (
              <RenderSlot<SkillComposerExtraProps>
                ctx={clientCtx}
                name="session.chrome.composer"
                entryKey={sessionDriver}
                owner={{
                  skills,
                  selectedSkill,
                  disabled: !composerEnabled,
                  onSelectSkill: setSelectedSkill,
                }}
                fallback={() => null}
              />
            )}
            <Composer value={composerText} onChange={setComposerText} onSubmit={handleSubmit} disabled={!composerEnabled} />
          </>
        }
      >
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
              onCopied={() => pushToast('Đã sao chép')}
            />
          )
        })}
        {showStreamingRow && <StreamingRow />}
        <div ref={messagesEndRef} />
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
