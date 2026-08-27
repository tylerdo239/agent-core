import WebSocket from 'ws'

const base = 'http://localhost:8787'
const token = process.argv[2]
const driver = process.argv[3] || 'default'
const bodyExtra = process.argv[4] ? JSON.parse(process.argv[4]) : {}

async function main() {
  const createRes = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ driver, ...bodyExtra }),
  })
  const created = await createRes.json()
  console.log('CREATE', createRes.status, JSON.stringify(created))
  const sessionId = created.id

  const ws = new WebSocket(`ws://localhost:8787/sessions/${sessionId}/events/stream?token=${encodeURIComponent(token)}`)
  let doneCount = 0
  let errorCount = 0
  let tokenCount = 0
  let stepCount = 0
  const messages = []

  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  console.log('WS_OPEN')

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    messages.push(msg.type)
    if (msg.type === 'done') doneCount++
    if (msg.type === 'error') errorCount++
    if (msg.type === 'step' && msg.step?.type === 'token') tokenCount++
    if (msg.type === 'step') stepCount++
  })

  const msgRes = await fetch(`${base}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Xin chào, bạn khoẻ không? Trả lời ngắn gọn 1 câu.' }),
  })
  const msgResult = await msgRes.json()
  console.log('MESSAGE_POST', msgRes.status, JSON.stringify(msgResult).slice(0, 300))

  await new Promise((resolve) => setTimeout(resolve, 1500))

  console.log('SESSION_ID', sessionId)
  console.log('DONE_COUNT', doneCount)
  console.log('ERROR_COUNT', errorCount)
  console.log('TOKEN_STEP_COUNT', tokenCount)
  console.log('TOTAL_STEP_COUNT', stepCount)
  console.log('MESSAGE_TYPES', JSON.stringify(messages))
  ws.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('FATAL', err)
  process.exit(1)
})
