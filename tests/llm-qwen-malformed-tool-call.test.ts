// Bug thật phát hiện qua log production sau khi live-test tool web_search
// (2026-08, không phải giả thuyết): model đôi lúc nhét CẢ tên tool + JSON
// args + "đuôi rác" kiểu leak ChatML ("<tool_call>"/"<parameter>") vào field
// `name`, để field `arguments` riêng RỖNG. Ví dụ THẬT lấy trực tiếp từ
// sessions.db production (3 session khác nhau, cùng pattern):
//   name = 'web_search({"query":"thị trường viễn thông Việt Nam 2025 2026 quy mô","limit":10})]\n</tool_call'
//   name = 'web_search({"query":"FPT doanh thu lợi nhuận 2025 2026 so sánh toàn bộ","limit":10})\n</parameter'
// Hậu quả trước fix: tool KHÔNG chạy (TOOL_NOT_FOUND), search bị bỏ lỡ hoàn
// toàn lượt đó — model luôn tự retry đúng ngay bước sau (loop-default không
// dừng vì lỗi tool), nhưng tốn oan 1 step + hiện lỗi kỹ thuật xấu ra UI.
// Fix: bundles/providers/llm-qwen/index.ts repairToolCall() — tự tách đúng
// tên thật + parse JSON args khi `arguments` gốc rỗng và pattern khớp.
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

function openaiResponse(toolCallName: string, toolCallArguments: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: toolCallName, arguments: toolCallArguments } }],
          },
        },
      ],
    }),
    { status: 200 },
  )
}

describe('llm-qwen — repairToolCall() (gap thật: model leak ChatML vào field name)', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('complete(): name dạng "tool({json})]\\n</tool_call", arguments rỗng -> tự tách đúng tên + args', async () => {
    global.fetch = (async () =>
      openaiResponse('web_search({"query":"thị trường viễn thông Việt Nam 2025 2026 quy mô","limit":10})]\n</tool_call', '')
    ) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.complete([{ role: 'user', content: 'x' }], {})

    expect(result.toolCall).toEqual({
      name: 'web_search',
      args: { query: 'thị trường viễn thông Việt Nam 2025 2026 quy mô', limit: 10 },
    })
    await fiber.dispose()
  })

  it('complete(): biến thể "tool({json})\\n</parameter" (case thật thứ 2 từ log) -> tự tách đúng', async () => {
    global.fetch = (async () =>
      openaiResponse('web_search({"query":"FPT doanh thu lợi nhuận 2025 2026 so sánh toàn bộ","limit":10})\n</parameter', '')
    ) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.complete([{ role: 'user', content: 'x' }], {})

    expect(result.toolCall).toEqual({
      name: 'web_search',
      args: { query: 'FPT doanh thu lợi nhuận 2025 2026 so sánh toàn bộ', limit: 10 },
    })
    await fiber.dispose()
  })

  it('KHÔNG tự sửa khi `arguments` đã có giá trị hợp lệ -- name lạ nhưng args field đúng thì giữ nguyên cả 2 (không đè lên dữ liệu model đã trả đúng field)', async () => {
    global.fetch = (async () =>
      openaiResponse('web_search', '{"query":"giá vàng hôm nay"}')
    ) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.complete([{ role: 'user', content: 'x' }], {})

    expect(result.toolCall).toEqual({ name: 'web_search', args: { query: 'giá vàng hôm nay' } })
    await fiber.dispose()
  })

  // Bug thật lần 2 (2026-08, phát hiện qua "hunt" trực tiếp trên hệ thống
  // đang chạy — bản fix đầu chỉ check `arguments` RỖNG, không đủ): field
  // `arguments` đôi khi không rỗng nhưng chỉ có 1 fragment RÁC LẺ (`"{"`,
  // từ 1 delta stream lạc), `.trim()` vẫn coi là "có nội dung" nên bỏ qua
  // sửa — điều kiện đúng phải là "arguments có parse được JSON hợp lệ hay
  // không", không phải chỉ "có rỗng hay không".
  it('arguments có rác lẻ ("{" — 1 ký tự không parse được, KHÔNG rỗng) -- vẫn phải tự sửa, không bị guard chặn nhầm', async () => {
    global.fetch = (async () =>
      openaiResponse('web_search({"query":"FPT kết quả kinh doanh năm 2025 doanh thu lợi nhuận tăng trưởng","limit":10})]\n</tool_call', '{')
    ) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.complete([{ role: 'user', content: 'x' }], {})

    expect(result.toolCall).toEqual({
      name: 'web_search',
      args: { query: 'FPT kết quả kinh doanh năm 2025 doanh thu lợi nhuận tăng trưởng', limit: 10 },
    })
    await fiber.dispose()
  })

  it('name không khớp pattern (không phải lỗi ChatML leak) -> giữ nguyên hành vi cũ, args rỗng', async () => {
    global.fetch = (async () => openaiResponse('some tool name with spaces', '')) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.complete([{ role: 'user', content: 'x' }], {})

    expect(result.toolCall).toEqual({ name: 'some tool name with spaces', args: {} })
    await fiber.dispose()
  })

  it('JSON trong ngoặc bị hỏng (không parse được) -> KHÔNG đoán bừa, giữ nguyên name gốc để TOOL_NOT_FOUND làm lưới an toàn', async () => {
    global.fetch = (async () => openaiResponse('web_search({"query": broken json here})\n</tool_call', '')) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.complete([{ role: 'user', content: 'x' }], {})

    expect(result.toolCall?.name).toBe('web_search({"query": broken json here})\n</tool_call')
    expect(result.toolCall?.args).toEqual({})
    await fiber.dispose()
  })

  it('completeStream(): cùng pattern lỗi khi stream (chunk đầu mang name rác, arguments rỗng suốt) -> tự tách đúng', async () => {
    const encoder = new TextEncoder()
    const garbledName = 'web_search({"query":"FPT 2026 xu hướng thị trường công nghệ Việt Nam 2026","limit":10})]\n</parameter'
    const lines = [
      'data: {"choices":[{"delta":{"content":"","role":"assistant"}}]}\n\n',
      `data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"arguments":"","name":${JSON.stringify(garbledName)}},"type":"function","index":0}]}}]}\n\n`,
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\n',
      'data: [DONE]\n\n',
    ]
    global.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const line of lines) controller.enqueue(encoder.encode(line))
            controller.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )) as unknown as typeof fetch

    const { root, fiber } = await mount(BASE_CONFIG)
    const result = await root.llm.completeStream!([{ role: 'user', content: 'x' }], {}, () => {})

    expect(result.toolCall).toEqual({
      name: 'web_search',
      args: { query: 'FPT 2026 xu hướng thị trường công nghệ Việt Nam 2026', limit: 10 },
    })
    await fiber.dispose()
  })
})
