// Follow-up (2026-08) — streaming: user báo chưa thấy trả lời "gõ từng chữ".
// `completeStream()` mới thêm vào llm-qwen (seams/llm.ts, LlmService method
// TUỲ CHỌN) -- verify parser SSE đúng với shape THẬT đã probe trực tiếp
// `proxy.onebot.meobeo.ai` trước khi viết code (không phải đoán theo docs
// OpenAI chung chung): 2 phát hiện quan trọng đã encode vào fixture dưới
// đây -- (1) chunk tool_call ĐẦU mang cả `name` lẫn `arguments` rỗng, các
// chunk sau chỉ còn mảnh `arguments` phải tích luỹ dần; (2) `usage` chỉ ở
// chunk CUỐI cùng, sau khi đã có `finish_reason`.
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as llmQwenModule from '../bundles/providers/llm-qwen/index.ts'

async function settle() {
  await new Promise((r) => setTimeout(r, 5))
}

async function mount(config: Record<string, unknown>) {
  const root = new Context()
  const fiber = root.plugin(llmQwenModule, config)
  await settle()
  await fiber.await()
  return { root, fiber }
}

const BASE_CONFIG = { apiKey: 'k', baseUrl: 'http://fake-proxy.invalid', model: 'm' }

/** Dựng 1 Response(stream) thật từ mảng dòng SSE thô -- đúng dạng `res.body` mà completeStream() đọc qua getReader(). */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('llm-qwen — completeStream() (SSE thật, dựa trên probe trực tiếp proxy.onebot.meobeo.ai)', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('nội dung thường -> onDelta gọi đúng từng mảnh, content cuối ghép đủ, không có toolCall', async () => {
    global.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"","role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"xin"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" chào"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const deltas: string[] = []
    const result = await root.llm.completeStream!([{ role: 'user', content: 'hi' }], {}, (d) => deltas.push(d))

    expect(deltas).toEqual(['xin', ' chào'])
    expect(result.content).toBe('xin chào')
    expect(result.toolCall).toBeUndefined()
    await fiber.dispose()
  })

  it('tool_call streaming -> chunk đầu có name, các chunk sau chỉ có mảnh arguments, tích luỹ đúng thành args object hoàn chỉnh', async () => {
    global.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"","role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"arguments":"","name":"web_search"},"type":"function","index":0}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{"},"type":"function","index":0}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"query\\": \\"giá vàng hôm nay\\""},"type":"function","index":0}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"}"},"type":"function","index":0}]}}]}\n\n',
        'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\n',
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const deltas: string[] = []
    const result = await root.llm.completeStream!([{ role: 'user', content: 'giá vàng hôm nay' }], {}, (d) => deltas.push(d))

    expect(deltas).toEqual([]) // không có content nào stream -- chỉ tool_call
    expect(result.toolCall).toEqual({ name: 'web_search', args: { query: 'giá vàng hôm nay' } })
    await fiber.dispose()
  })

  // Bug thật phát hiện lúc verify E2E (2026-08, không phải giả thuyết): model
  // đôi khi tự quyết định phát NHIỀU tool_call trong 1 response (mỗi cái 1
  // `index` riêng — 0, 1...) khi làm nhiều lượt search cùng lúc (đúng hành vi
  // SKILL.md business-case-builder khuyến khích: "2-3 lượt web_search khác
  // góc độ"). Bản đầu của parser đọc `tool_calls[0]` theo VỊ TRÍ MẢNG (luôn
  // là phần tử DUY NHẤT trong mảng của 1 chunk, bất kể `.index` là gì) rồi
  // nối bừa `arguments` của CẢ 2 tool_call vào cùng 1 buffer — dính 2 JSON
  // object liền nhau ("{...}{...}"), JSON.parse() throw, args cuối cùng RỖNG
  // dù model có ý định rõ ràng (xác nhận qua fixture THẬT probe trực tiếp
  // proxy.onebot.meobeo.ai, không phải dựng tay). Fix: lọc đúng
  // `tc.index === 0`, bỏ qua hoàn toàn fragment của index khác.
  it('model phát NHIỀU tool_call (index 0 VÀ 1) trong 1 response -> chỉ giữ đúng index 0, KHÔNG dính lẫn args của index 1 vào', async () => {
    global.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_a","function":{"arguments":"","name":"web_search"},"type":"function","index":0}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{"},"type":"function","index":0}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"query\\": \\"FPT Telecom financial results 2025\\""},"type":"function","index":0}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"}"},"type":"function","index":0}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_b","function":{"arguments":"","name":"web_search"},"type":"function","index":1}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{"},"type":"function","index":1}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"query\\": \\"FPT Telecom market share Vietnam\\""},"type":"function","index":1}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"}"},"type":"function","index":1}]}}]}\n\n',
        'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\n',
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.completeStream!([{ role: 'user', content: 'phân tích FPT Telecom' }], {}, () => {})

    // Đúng, hợp lệ, và KHÔNG rỗng — trước khi sửa, đây ra {} (JSON.parse throw).
    expect(result.toolCall).toEqual({ name: 'web_search', args: { query: 'FPT Telecom financial results 2025' } })
    await fiber.dispose()
  })

  it('usage CHỈ ở chunk cuối -> vẫn đọc được đúng, không throw vì chunk trước không có usage', async () => {
    global.fetch = (async () =>
      sseResponse([
        'data: {"model":"m-thật","choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.completeStream!([{ role: 'user', content: 'hi' }], {}, () => {})

    expect(result.model).toBe('m-thật')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12, cost: undefined })
    await fiber.dispose()
  })

  it('1 chunk SSE bị cắt giữa 2 lần đọc stream (buffer chưa đủ 1 dòng) -- vẫn ghép đúng, không mất/lặp nội dung', async () => {
    // Mô phỏng TCP fragment thật: dòng JSON của 1 chunk bị chia làm 2 lần enqueue.
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"xin'))
        controller.enqueue(encoder.encode(' chào"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    global.fetch = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const deltas: string[] = []
    const result = await root.llm.completeStream!([{ role: 'user', content: 'hi' }], {}, (d) => deltas.push(d))

    expect(deltas).toEqual(['xin chào'])
    expect(result.content).toBe('xin chào')
    await fiber.dispose()
  })

  // Merge feat/rlm-dev-integration: completeStream() giờ dùng CHUNG
  // postChatCompletion() với complete() (xem bundles/providers/shared/
  // llm-http.ts) -- lỗi HTTP không-ok ném ra LlmError có message theo dạng
  // "<provider>: server error <status>: <chi tiết đã rút gọn>" thay vì chuỗi
  // "streaming request failed" cũ (ad-hoc, trước khi có helper dùng chung).
  // Round 2 (2026-08): statusError() giờ đọc thêm body lỗi thật (redact
  // secret, cắt tối đa 600 ký tự) và nối vào message -- assertion cũ khớp
  // ĐÚNG BẰNG chuỗi cố định đã lỗi thời từ lúc merge này thêm chi tiết đó.
  it('response không ok (lỗi HTTP) -> throw ngay, không gọi onDelta lần nào', async () => {
    global.fetch = (async () => new Response('server error', { status: 500 })) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const onDelta = () => { throw new Error('KHÔNG được gọi') }
    await expect(root.llm.completeStream!([{ role: 'user', content: 'hi' }], {}, onDelta)).rejects.toMatchObject({
      message: 'llm-qwen: server error 500: server error',
      code: 'LLM_SERVER_ERROR',
      status: 500,
    })
    await fiber.dispose()
  })
})
