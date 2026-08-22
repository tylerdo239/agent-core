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
import { Button, Modal, Pill, StateDot, ToastContainer, useToasts } from '@agent-core/ui-primitives'
import { AppFrame } from '@agent-core/ui-layout'
import { AdminUsersPanel, clearAuthState, loadAuthState, LoginForm, saveAuthState, SignupForm, type AuthState } from '@agent-core/ui-auth'
import { cacheSessionTitle, fetchSessionHistory, Sidebar, type SessionSummary } from '@agent-core/ui-sidebar'
import { Composer, EmptyState, GenericToolCard, MessageBubble, StreamingRow, ToolRow } from '@agent-core/ui-conversation'
import { defaultSettings, loadSettings, saveSettings, SettingsForm, type Settings } from '@agent-core/ui-settings-general'
import styles from './App.module.css'
import { createClientContext } from './client-context.ts'

type ToolUiHint = ToolViewOwnerProps['toolUi']

interface LoopStep {
  // 'user_message' KHÔNG bao giờ đến qua step LIVE (agent/step) — chỉ xuất
  // hiện khi đọc lại event log THẬT qua GET /sessions/:id/events (xem
  // reconstructItems()). Gộp chung interface để dùng lại 1 type cho cả 2
  // nguồn (LoopStep từ WS 'step' và StoredEvent từ REST), tránh 2 kiểu dữ
  // liệu gần giống nhau song song.
  type: 'user_message' | 'model_message' | 'tool_result' | 'critic_message' | 'final'
  content?: string
  toolCall?: { name: string; args: Record<string, unknown> }
  toolUi?: ToolUiHint
  name?: string
  result?: unknown
}

type ChatItem =
  | { kind: 'user' | 'assistant' | 'system' | 'error' | 'critic'; id: string; text: string; ts?: number }
  | {
      kind: 'tool'
      id: string
      toolCall: { name: string; args: Record<string, unknown> }
      toolUi?: ToolUiHint
      state: 'running' | 'ok' | 'error'
      result?: unknown
      errorText?: string
    }

let nextId = 0
function genId(): string {
  nextId += 1
  return `item-${nextId}`
}

type ConnStatus = 'connecting' | 'connected' | 'disconnected'

function toolRowSummary(item: Extract<ChatItem, { kind: 'tool' }>): string {
  if (item.state === 'error') return item.errorText ?? 'lỗi'
  if (item.state === 'ok' && item.toolUi?.render === 'citations') {
    const results = (item.result as { results?: unknown[] } | undefined)?.results
    if (Array.isArray(results)) return results.length ? `${results.length} nguồn` : 'không tìm thấy kết quả'
  }
  return JSON.stringify(item.toolCall.args ?? {})
}

export function App() {
  const [clientCtx, setClientCtx] = useState<Context | null>(null)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuthState())
  const [authView, setAuthView] = useState<'login' | 'signup'>('login')
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [items, setItems] = useState<ChatItem[]>([])
  const [turnInFlight, setTurnInFlight] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<Settings>(settings)
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])

  const { toasts, push: pushToast } = useToasts()

  const wsRef = useRef<WebSocket | null>(null)
  const activeToolItemIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  // Session hiện tại đã có tin nhắn user đầu tiên chưa — chỉ cập nhật title
  // lịch sử ĐÚNG 1 LẦN cho câu hỏi đầu tiên, không ghi đè bằng câu hỏi sau.
  const titledSessionIdsRef = useRef<Set<string>>(new Set())

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
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [items])

  useEffect(() => {
    if (settingsOpen) setSettingsDraft(settings)
  }, [settingsOpen, settings])

  // `resumeSessionId`: khi có, KHÔNG gửi 'create_session' — session đó ĐÃ
  // tồn tại server-side (miễn còn trong TTL trượt của session-registry, xem
  // Phase 8.1). WS protocol không có message riêng "resume" — `send_message`
  // chấp nhận BẤT KỲ sessionId hợp lệ nào, không quan tâm nó được tạo qua
  // kết nối WS nào, nên chỉ cần bỏ qua bước create_session là đủ.
  function connect(current: Settings, token: string, resumeSessionId?: string) {
    setStatus('connecting')
    setSessionId(resumeSessionId ?? null)
    activeToolItemIdRef.current = null

    const url = `${current.wsUrl}/?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      if (resumeSessionId) {
        setStatus('connected')
        return
      }
      ws.send(JSON.stringify({ type: 'create_session', systemPrompt: 'Bạn là trợ lý hữu ích, trả lời ngắn gọn.' }))
    })

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)

      if (msg.type === 'session_created') {
        setSessionId(msg.id)
        setStatus('connected')
        setItems((prev) => [...prev, { kind: 'system', id: genId(), text: `Session mới: ${msg.id} (driver: ${msg.driver})`, ts: Date.now() }])
        // Thêm optimistic lên ĐẦU list — server đã gắn ownerId thật lúc tạo
        // (create_session qua WS truyền identity đã verify), lần fetch
        // GET /sessions tiếp theo sẽ thấy đúng session này; thêm ngay ở đây
        // để UI phản hồi tức thời, không đợi round-trip fetch lại.
        setSessions((prev) => [{ id: msg.id, createdAt: Date.now(), title: 'Cuộc trò chuyện mới' }, ...prev])
        return
      }

      if (msg.type === 'step') {
        applyStep(msg.step as LoopStep)
        return
      }

      if (msg.type === 'done') {
        setTurnInFlight(false)
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
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), text: `🔍 đang rà soát: ${step.content}`, ts: Date.now() }])
      return
    }
    if (step.type === 'final') {
      setItems((prev) => [...prev, { kind: 'assistant', id: genId(), text: step.content ?? '', ts: Date.now() }])
      return
    }
  }

  function startNewChat(current: Settings, token: string) {
    wsRef.current?.close()
    wsRef.current = null
    activeToolItemIdRef.current = null
    setItems([])
    connect(current, token)
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
        result.push({ kind: 'critic', id: genId(), text: `🔍 đang rà soát: ${step.content}` })
      }
    }
    return result
  }

  // Chuyển sang 1 session CŨ (click trong Sidebar) — tải lại lịch sử thật
  // qua REST (KHÔNG phải WS, vốn không có message "resume"), rồi mở kết nối
  // WS mới bỏ qua create_session (session đã tồn tại server-side).
  async function resumeSession(id: string) {
    if (id === sessionId || !auth) return
    try {
      const res = await fetch(`${settings.restUrl}/sessions/${id}/events`, {
        headers: { authorization: `Bearer ${auth.token}` },
      })
      if (!res.ok) {
        pushToast(
          res.status === 404 ? 'Cuộc trò chuyện này đã hết hạn hoặc không còn tồn tại.' : `Không tải được lịch sử (lỗi ${res.status}).`,
          'error',
        )
        return
      }
      const { events } = (await res.json()) as { events: LoopStep[] }
      wsRef.current?.close()
      wsRef.current = null
      activeToolItemIdRef.current = null
      setItems(reconstructItems(events))
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
    fetchSessionHistory(settings.restUrl, auth.token)
      .then(setSessions)
      .catch(() => pushToast('Không tải được danh sách cuộc trò chuyện.', 'error'))
    connect(settings, auth.token)
    return () => {
      wsRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const text = composerText.trim()
    const ws = wsRef.current
    if (!text || !sessionId || turnInFlight || !ws || ws.readyState !== WebSocket.OPEN) return

    setItems((prev) => [...prev, { kind: 'user', id: genId(), text, ts: Date.now() }])
    setComposerText('')
    setTurnInFlight(true)
    // Chỉ đặt title 1 LẦN cho câu hỏi ĐẦU TIÊN của session (Set tránh ghi đè
    // bằng câu hỏi sau, và tránh ghi đè session đã resume có title thật).
    if (!titledSessionIdsRef.current.has(sessionId)) {
      titledSessionIdsRef.current.add(sessionId)
      const title = cacheSessionTitle(sessionId, text)
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)))
    }
    ws.send(JSON.stringify({ type: 'send_message', sessionId, message: text }))
  }

  function handleSettingsSubmit(event: React.FormEvent) {
    event.preventDefault()
    const next: Settings = {
      restUrl: settingsDraft.restUrl.trim() || defaultSettings().restUrl,
      wsUrl: settingsDraft.wsUrl.trim() || defaultSettings().wsUrl,
    }
    saveSettings(next)
    setSettings(next)
    setSettingsOpen(false)
    if (auth) startNewChat(next, auth.token)
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

  const composerEnabled = status === 'connected' && !!sessionId && !turnInFlight
  const statusLabel =
    status === 'connected' && sessionId ? `đã kết nối — session ${sessionId.slice(0, 8)}` : status === 'connecting' ? 'đang kết nối...' : 'mất kết nối'
  const statusTone = status === 'connected' ? 'success' : status === 'disconnected' ? 'error' : 'neutral'

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
            onSelectSession={resumeSession}
            onOpenSettings={() => setSettingsOpen(true)}
            isAdmin={auth.user.role === 'admin'}
            onOpenAdminPanel={() => setAdminPanelOpen(true)}
            currentUsername={auth.user.username}
            onLogout={handleLogout}
          />
        }
        header={
          <>
            <h1>agent-core</h1>
            <div className={styles.headerActions}>
              <Pill tone={statusTone}>
                <StateDot variant={status} />
                {statusLabel}
              </Pill>
            </div>
          </>
        }
        footer={<Composer value={composerText} onChange={setComposerText} onSubmit={handleSubmit} disabled={!composerEnabled} />}
      >
        {items.length === 0 && <EmptyState />}
        {items.map((item) => {
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
              ts={item.ts}
              onCopied={() => pushToast('Đã sao chép')}
            />
          )
        })}
        {showStreamingRow && <StreamingRow />}
        <div ref={messagesEndRef} />
      </AppFrame>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsForm draft={settingsDraft} onChange={setSettingsDraft} onSubmit={handleSettingsSubmit} onCancel={() => setSettingsOpen(false)} />
      </Modal>

      <AdminUsersPanel
        open={adminPanelOpen}
        onClose={() => setAdminPanelOpen(false)}
        restUrl={settings.restUrl}
        token={auth.token}
        currentUserId={auth.user.id}
      />
    </>
  )
}
