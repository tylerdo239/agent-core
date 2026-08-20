// Toàn bộ logic nghiệp vụ của demo UI sống ở ĐÂY (phía browser) — bundle
// web-ui chỉ serve file tĩnh, không có server-side logic nào khác. Gọi
// thẳng vào REST (tạo/đọc) và WS (gửi message + nhận stream) như 1 client
// bên ngoài, đúng interface public của agent-core, không có API riêng nào
// khác dành cho UI này.
'use strict';

const STORAGE_KEY = 'agent-core-ui-settings';

const els = {
  messages: document.getElementById('messages'),
  status: document.getElementById('status'),
  form: document.getElementById('compose-form'),
  input: document.getElementById('compose-input'),
  send: document.getElementById('compose-send'),
  newChatBtn: document.getElementById('new-chat-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsForm: document.getElementById('settings-form'),
  settingsCancel: document.getElementById('settings-cancel'),
  settingsRest: document.getElementById('settings-rest'),
  settingsWs: document.getElementById('settings-ws'),
  settingsKey: document.getElementById('settings-key'),
};

function defaultSettings() {
  const proto = location.protocol === 'https:' ? 'https:' : 'http:';
  const wsProto = proto === 'https:' ? 'wss:' : 'ws:';
  return {
    restUrl: `${proto}//${location.hostname}:8787`,
    wsUrl: `${wsProto}//${location.hostname}:8788`,
    apiKey: '',
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

let settings = loadSettings();
let ws = null;
let sessionId = null;
let turnInFlight = false;

function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = `status status-${cls}`;
}

function addMessage(kind, text) {
  const div = document.createElement('div');
  div.className = `msg msg-${kind}`;
  div.textContent = text; // textContent — KHÔNG innerHTML, tránh XSS từ nội dung agent/tool trả về
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  return div;
}

function setComposerEnabled(enabled) {
  els.input.disabled = !enabled;
  els.send.disabled = !enabled;
}

// Tool call row — dựa theo pattern "ToolRow" thật của deepseek-harness
// (packages/client/ui-tool): 1 dòng đơn thu gọn (icon + title + tóm tắt),
// collapsed-by-default, click để mở rộng xem chi tiết. Chỉ 1 tool chạy tại 1
// thời điểm trong kiến trúc hiện tại (loop tuần tự, không song song), nên
// giữ 1 tham chiếu DUY NHẤT tới row đang chạy là đủ, không cần map theo id.
let activeToolRow = null;

// Phase 8.5: KHÔNG hardcode theo tên tool ở đây nữa — icon/label đến từ
// `step.toolUi` (tool tự khai qua ToolDefinition.ui, xem seams/tools.ts),
// tool không khai thì dùng fallback chung bên dưới. Summary luôn là
// JSON.stringify(args) thô — đơn giản, không cần server gửi thêm 1 field
// "summary template" chỉ để tránh 1 dòng JSON.stringify ở client.
function toolRowSummary(toolCall) {
  return JSON.stringify(toolCall.args ?? {});
}

// Tạo row ở trạng thái "đang chạy" — dsh dùng 1 sweep shimmer trên chính
// dòng header thay vì 1 bubble riêng nhấp nháy, giữ mọi tool call cùng 1
// chrome nhất quán (xem ToolRow.tsx trong dsh thật).
function createToolRow(toolCall, toolUi) {
  const meta = { icon: toolUi?.icon ?? '🔧', title: toolUi?.label ?? toolCall.name };

  const root = document.createElement('div');
  root.className = 'msg tool-row';
  root.dataset.state = 'running';

  const header = document.createElement('div');
  header.className = 'tool-row-header';

  const icon = document.createElement('span');
  icon.className = 'tool-row-icon';
  icon.textContent = meta.icon;
  header.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'tool-row-title';
  title.textContent = meta.title;
  header.appendChild(title);

  const sep = document.createElement('span');
  sep.className = 'tool-row-sep';
  sep.textContent = '·';
  header.appendChild(sep);

  const summary = document.createElement('span');
  summary.className = 'tool-row-summary';
  summary.textContent = toolRowSummary(toolCall);
  header.appendChild(summary);

  const chevron = document.createElement('span');
  chevron.className = 'tool-row-chevron';
  chevron.textContent = '›';
  header.appendChild(chevron);

  const body = document.createElement('div');
  body.className = 'tool-row-body';
  body.hidden = true;

  root.appendChild(header);
  root.appendChild(body);
  els.messages.appendChild(root);
  els.messages.scrollTop = els.messages.scrollHeight;

  return { root, header, icon, summary, chevron, body };
}

// Chốt row sang trạng thái cuối (ok/error) — chỉ cho phép click mở rộng khi
// có nội dung body thật, giống dsh (`expandable = body/output/card !== null`).
function settleToolRow(row, { state, summaryText, bodyNode }) {
  row.root.dataset.state = state;
  if (summaryText !== undefined) row.summary.textContent = summaryText;
  if (state === 'error') {
    row.icon.textContent = '●';
    row.icon.classList.add('tool-row-icon-error');
  }

  if (!bodyNode) {
    row.chevron.remove();
    return;
  }
  row.body.appendChild(bodyNode);
  row.header.addEventListener('click', () => {
    row.body.hidden = !row.body.hidden;
    row.chevron.classList.toggle('tool-row-chevron-open', !row.body.hidden);
  });
  row.header.tabIndex = 0;
  row.header.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      row.header.click();
    }
  });
}

function renderStep(step) {
  switch (step.type) {
    case 'model_message':
      if (step.toolCall) {
        activeToolRow = createToolRow(step.toolCall, step.toolUi);
      }
      // model_message KHÔNG có toolCall = nội dung sẽ trùng với step 'final'
      // ngay sau đó — không render lặp, tránh hiện 2 lần cùng 1 câu trả lời.
      return;
    case 'tool_result':
      renderToolResult(step.result, step.toolUi);
      return;
    case 'critic_message':
      addMessage('step', `🔍 đang rà soát: ${step.content}`);
      return;
    case 'final':
      addMessage('assistant', step.content);
      return;
  }
}

// Phase 8.5: dispatch theo `toolUi.render` (server khai qua ToolDefinition.ui)
// thay vì hardcode theo tên tool. `render === 'citations'` mà result không có
// mảng `results` hợp lệ thì rơi về card IN/OUT chung — không crash vì 1 tool
// khai sai hint.
function renderToolResult(result, toolUi) {
  const row = activeToolRow;
  activeToolRow = null;
  if (!row) return; // không mong đợi (mọi tool_result phải có row đang chạy trước nó), nhưng không để hỏng cả UI vì 1 lệch pha.

  const errorText = result && typeof result.error === 'string' ? result.error : null;

  if (toolUi?.render === 'citations' && result && Array.isArray(result.results)) {
    settleToolRow(row, {
      state: errorText ? 'error' : 'ok',
      summaryText: errorText ?? (result.results.length ? `${result.results.length} nguồn` : 'không tìm thấy kết quả'),
      bodyNode: errorText ? null : buildSearchSources(result.results),
    });
    return;
  }

  settleToolRow(row, {
    state: errorText ? 'error' : 'ok',
    summaryText: errorText ?? undefined,
    bodyNode: buildIoCard(row.summary.textContent, result),
  });
}

// Danh sách nguồn dạng "citation list" đánh số — theo đúng WebBlock thật
// của dsh (packages/client/ui-primitives/src/WebBlock.tsx): <ol> đơn giản,
// mỗi nguồn là 1 link (title, fallback hostname) + snippet, KHÔNG dùng card/
// favicon dạng lưới. Dùng textContent cho mọi phần lấy từ tool trả về,
// không dùng innerHTML (tránh XSS).
function buildSearchSources(results) {
  if (!results.length) return null;
  const ol = document.createElement('ol');
  ol.className = 'tool-sources';
  for (const r of results) {
    let label = r.title;
    if (!label) {
      try {
        label = new URL(r.url).hostname;
      } catch {
        label = r.url;
      }
    }

    const li = document.createElement('li');
    li.className = 'tool-source';

    const link = document.createElement('a');
    link.className = 'tool-source-link';
    link.href = r.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    li.appendChild(link);

    if (r.snippet) {
      const snippet = document.createElement('div');
      snippet.className = 'tool-source-snippet';
      snippet.textContent = r.snippet;
      li.appendChild(snippet);
    }

    ol.appendChild(li);
  }
  return ol;
}

// Card IN/OUT chung cho mọi tool khác (query_database, tool không rõ...) —
// mirror geometry IN/OUT của dsh (nhãn cột trái + text đơn dòng cuộn ngang).
function buildIoCard(inputText, result) {
  const card = document.createElement('div');
  card.className = 'tool-io';

  const inRow = document.createElement('div');
  inRow.className = 'tool-io-row';
  const inLabel = document.createElement('span');
  inLabel.className = 'tool-io-label';
  inLabel.textContent = 'IN';
  const inText = document.createElement('span');
  inText.className = 'tool-io-text';
  inText.textContent = inputText;
  inRow.append(inLabel, inText);
  card.appendChild(inRow);

  const outRow = document.createElement('div');
  outRow.className = 'tool-io-row';
  const outLabel = document.createElement('span');
  outLabel.className = 'tool-io-label';
  outLabel.textContent = 'OUT';
  const outText = document.createElement('span');
  outText.className = 'tool-io-text';
  outText.textContent = JSON.stringify(result);
  outRow.append(outLabel, outText);
  card.appendChild(outRow);

  return card;
}

function connect() {
  if (!settings.apiKey) {
    openSettings();
    return;
  }
  setStatus('đang kết nối...', 'connecting');
  setComposerEnabled(false);
  sessionId = null;

  const url = `${settings.wsUrl}/?key=${encodeURIComponent(settings.apiKey)}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'create_session', systemPrompt: 'Bạn là trợ lý hữu ích, trả lời ngắn gọn.' }));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'session_created') {
      sessionId = msg.id;
      setStatus(`đã kết nối — session ${msg.id.slice(0, 8)}`, 'connected');
      setComposerEnabled(true);
      addMessage('system', `Session mới: ${msg.id} (driver: ${msg.driver})`);
      return;
    }
    if (msg.type === 'step') {
      renderStep(msg.step);
      return;
    }
    if (msg.type === 'done') {
      turnInFlight = false;
      setComposerEnabled(true);
      return;
    }
    if (msg.type === 'error') {
      turnInFlight = false;
      setComposerEnabled(!!sessionId);
      // Tool throw (vd. permission denied, lỗi network trong web_search) đi
      // thẳng ra đây thay vì qua step 'tool_result' — nếu đang có 1 tool row
      // "đang chạy" dở, chốt nó sang trạng thái lỗi luôn, không để pulsing
      // mãi mãi (bug đã có trước khi thêm error state cho tool row).
      if (activeToolRow) {
        const row = activeToolRow;
        activeToolRow = null;
        settleToolRow(row, { state: 'error', summaryText: msg.message, bodyNode: null });
      }
      addMessage('error', `Lỗi: ${msg.message}`);
      return;
    }
  });

  ws.addEventListener('close', (event) => {
    setStatus(`mất kết nối (${event.code})`, 'disconnected');
    setComposerEnabled(false);
    if (event.code === 401) {
      addMessage('error', 'API key không hợp lệ — mở ⚙ để sửa lại.');
    }
  });

  ws.addEventListener('error', () => {
    setStatus('lỗi kết nối', 'disconnected');
  });
}

function startNewChat() {
  if (ws) ws.close();
  els.messages.innerHTML = '';
  activeToolRow = null;
  connect();
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text || !sessionId || turnInFlight || !ws || ws.readyState !== WebSocket.OPEN) return;

  addMessage('user', text);
  els.input.value = '';
  turnInFlight = true;
  setComposerEnabled(false);
  ws.send(JSON.stringify({ type: 'send_message', sessionId, message: text }));
});

els.newChatBtn.addEventListener('click', startNewChat);

function openSettings() {
  els.settingsRest.value = settings.restUrl;
  els.settingsWs.value = settings.wsUrl;
  els.settingsKey.value = settings.apiKey;
  els.settingsDialog.showModal();
}

els.settingsBtn.addEventListener('click', openSettings);
els.settingsCancel.addEventListener('click', () => els.settingsDialog.close());

els.settingsForm.addEventListener('submit', () => {
  settings = {
    restUrl: els.settingsRest.value.trim() || defaultSettings().restUrl,
    wsUrl: els.settingsWs.value.trim() || defaultSettings().wsUrl,
    apiKey: els.settingsKey.value.trim(),
  };
  saveSettings(settings);
  startNewChat();
});

// Khởi động: có key sẵn (lần trước đã lưu) thì tự kết nối, chưa có thì mở
// settings luôn — không để user nhìn màn hình trống không biết làm gì.
if (settings.apiKey) {
  connect();
} else {
  openSettings();
}
