// apps/web/src/App.tsx — Phase 9.4: cây component chính, thay renderStep()/
// addMessage() thủ công trong app.js cũ (Phase 7/8.5) bằng state React. Giao
// thức REST/WS giữ NGUYÊN (không đổi API backend) — chỉ đổi cách render phía
// client. `clientCtx` (cây Cordis riêng chạy trong trình duyệt, Phase 9.4)
// dùng cho `RenderSlot(clientCtx, 'tool.call.toolview', ...)` tại đúng chỗ
// turn có tool call — GenericToolCard (Phase 9.4) là fallback bắt buộc khi
// tool không có UI-plugin riêng (Phase 9.5 chưa mount cái nào, nên mọi tool
// call hiện tại đều rơi vào đường fallback này — đúng như thiết kế).
import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { RenderSlot } from '@agent-core/ui-react'
import type { ToolViewOwnerProps } from '@agent-core/ui-slots'
import { Button, Modal, Pill, StateDot, ToastContainer, useToasts } from '@agent-core/ui-primitives'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { createClientContext } from './client-context.ts'
import { GenericToolCard } from './GenericToolCard.tsx'
import { Sidebar } from './Sidebar.tsx'
import { ToolRow } from './ToolRow.tsx'
import { defaultSettings, loadSettings, saveSettings, type Settings } from './settings.ts'
import { addSessionToHistory, loadSessionHistory, updateSessionTitle, type SessionSummary } from './sessionHistory.ts'

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
  | { kind: 'user' | 'assistant' | 'system' | 'error' | 'critic'; id: string; text: string }
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
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [items, setItems] = useState<ChatItem[]>([])
  const [turnInFlight, setTurnInFlight] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<Settings>(settings)
  const [sessions, setSessions] = useState<SessionSummary[]>(() => loadSessionHistory())

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
  function connect(current: Settings, resumeSessionId?: string) {
    if (!current.apiKey) {
      setSettingsOpen(true)
      return
    }
    setStatus('connecting')
    setSessionId(resumeSessionId ?? null)
    activeToolItemIdRef.current = null

    const url = `${current.wsUrl}/?key=${encodeURIComponent(current.apiKey)}`
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
        setItems((prev) => [...prev, { kind: 'system', id: genId(), text: `Session mới: ${msg.id} (driver: ${msg.driver})` }])
        setSessions(addSessionToHistory(msg.id))
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
        setItems((prev) => [...prev, { kind: 'error', id: genId(), text: `Lỗi: ${msg.message}` }])
        return
      }
    })

    ws.addEventListener('close', (event) => {
      setStatus('disconnected')
      // Lỗi kết nối/hệ thống -> toast thoáng qua, KHÔNG phải bubble chat vĩnh
      // viễn (khác lỗi tool throw giữa turn, vẫn giữ trong chat vì đó là nội
      // dung hội thoại thật, không phải thông báo hệ thống).
      if (event.code === 401) {
        pushToast('API key không hợp lệ — mở ⚙ để sửa lại.', 'error')
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
      setItems((prev) => [...prev, { kind: 'critic', id: genId(), text: `🔍 đang rà soát: ${step.content}` }])
      return
    }
    if (step.type === 'final') {
      setItems((prev) => [...prev, { kind: 'assistant', id: genId(), text: step.content ?? '' }])
      return
    }
  }

  function startNewChat(current: Settings) {
    wsRef.current?.close()
    wsRef.current = null
    activeToolItemIdRef.current = null
    setItems([])
    connect(current)
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
    if (id === sessionId) return
    try {
      const res = await fetch(`${settings.restUrl}/sessions/${id}/events`, {
        headers: { authorization: `Bearer ${settings.apiKey}` },
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
      connect(settings, id)
    } catch {
      pushToast('Không thể tải lại cuộc trò chuyện này — kiểm tra kết nối.', 'error')
    }
  }

  // Kết nối lần đầu khi mount — có key sẵn (đã lưu lần trước) thì tự kết nối,
  // chưa có thì mở settings luôn (không để user nhìn màn hình trống không
  // biết làm gì) — đúng hành vi app.js cũ.
  useEffect(() => {
    if (settings.apiKey) connect(settings)
    else setSettingsOpen(true)
    return () => {
      wsRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const text = composerText.trim()
    const ws = wsRef.current
    if (!text || !sessionId || turnInFlight || !ws || ws.readyState !== WebSocket.OPEN) return

    setItems((prev) => [...prev, { kind: 'user', id: genId(), text }])
    setComposerText('')
    setTurnInFlight(true)
    // Chỉ đặt title 1 LẦN cho câu hỏi ĐẦU TIÊN của session (Set tránh ghi đè
    // bằng câu hỏi sau, và tránh ghi đè session đã resume có title thật).
    if (!titledSessionIdsRef.current.has(sessionId)) {
      titledSessionIdsRef.current.add(sessionId)
      setSessions(updateSessionTitle(sessionId, text))
    }
    ws.send(JSON.stringify({ type: 'send_message', sessionId, message: text }))
  }

  function handleSettingsSubmit(event: React.FormEvent) {
    event.preventDefault()
    const next: Settings = {
      restUrl: settingsDraft.restUrl.trim() || defaultSettings().restUrl,
      wsUrl: settingsDraft.wsUrl.trim() || defaultSettings().wsUrl,
      apiKey: settingsDraft.apiKey.trim(),
    }
    saveSettings(next)
    setSettings(next)
    setSettingsOpen(false)
    startNewChat(next)
  }

  const composerEnabled = status === 'connected' && !!sessionId && !turnInFlight
  const statusLabel =
    status === 'connected' && sessionId ? `đã kết nối — session ${sessionId.slice(0, 8)}` : status === 'connecting' ? 'đang kết nối...' : 'mất kết nối'
  const statusTone = status === 'connected' ? 'success' : status === 'disconnected' ? 'error' : 'neutral'

  return (
    <div id="app">
      <ToastContainer toasts={toasts} />
      {/* Layout 2 cột (sidebar + khung chat chính) — xem Sidebar.tsx cho lý
          do đơn giản hoá so với AppFrame 3 cột thật của dsh. */}
      <Sidebar
        sessions={sessions}
        activeSessionId={sessionId}
        onNewChat={() => startNewChat(settings)}
        onSelectSession={resumeSession}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div id="main">
        <header>
          <h1>agent-core</h1>
          <div className="header-actions">
            <Pill tone={statusTone}>
              <StateDot variant={status} />
              {statusLabel}
            </Pill>
          </div>
        </header>

        <main id="messages" aria-live="polite">
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
          // Phase 10.4: assistant KHÔNG còn là bubble — chảy full-width,
          // render markdown thật (đúng pattern AssistantMarkdown thật của
          // dsh), khác hẳn user/step/error/system vẫn là bubble/dòng ngắn.
          if (item.kind === 'assistant') {
            return (
              <div key={item.id} className="msg msg-assistant">
                <AssistantMarkdown content={item.text} />
              </div>
            )
          }
          const cssKind = item.kind === 'critic' ? 'step' : item.kind
          return (
            <div key={item.id} className={`msg msg-${cssKind}`}>
              {item.text}
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </main>

      <form
        id="compose-form"
        onSubmit={handleSubmit}
      >
        <input
          id="compose-input"
          type="text"
          placeholder="Nhắn gì đó cho agent..."
          autoComplete="off"
          disabled={!composerEnabled}
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!composerEnabled}>
          Gửi
        </Button>
      </form>
      </div>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <form id="settings-form" onSubmit={handleSettingsSubmit}>
          <h2>Cấu hình kết nối</h2>
          <label>
            REST URL
            <input
              type="text"
              placeholder="http://localhost:8787"
              value={settingsDraft.restUrl}
              onChange={(e) => setSettingsDraft((s) => ({ ...s, restUrl: e.target.value }))}
            />
          </label>
          <label>
            WebSocket URL
            <input
              type="text"
              placeholder="ws://localhost:8788"
              value={settingsDraft.wsUrl}
              onChange={(e) => setSettingsDraft((s) => ({ ...s, wsUrl: e.target.value }))}
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              placeholder="Bearer token"
              value={settingsDraft.apiKey}
              onChange={(e) => setSettingsDraft((s) => ({ ...s, apiKey: e.target.value }))}
            />
          </label>
          <p className="hint">Lưu trong localStorage của trình duyệt này — không gửi đi đâu khác ngoài 2 URL ở trên.</p>
          <div className="dialog-actions">
            <Button type="button" onClick={() => setSettingsOpen(false)}>
              Huỷ
            </Button>
            <Button type="submit" variant="primary">
              Lưu &amp; kết nối
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
