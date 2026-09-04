// Bug thật gặp lúc chạy model thật: proxy trả 429 với body
// "Rate limit exceeded for api_key: 560f79...". Key hex trần lọt cả luật
// Bearer lẫn luật sk-, nên nguyên key đi vào message lỗi -> storage.appendEvent
// -> UI. Message lỗi LLM là dữ liệu upstream không tin được: phải che trước
// khi nó thành event lưu vĩnh viễn.
import { describe, expect, it } from 'vitest'
import { statusError } from '../bundles/providers/shared/llm-http.ts'

const KEY = '560f79f740726d75079821552965bfab364f4adf143ff376bd1964051ae7016'

function res(status: number, body: string) {
  return new Response(body, { status })
}

describe('llm-http — che secret trong message lỗi upstream', () => {
  it('429 kèm api_key hex trần -> key KHÔNG lọt ra message', async () => {
    const error = await statusError('llm-qwen', res(429, JSON.stringify({ error: { message: `Rate limit exceeded for api_key: ${KEY}` } })))
    expect(error.message).not.toContain(KEY)
    expect(error.message).toContain('[redacted]')
    expect(error.message).toContain('rate limited')
  })

  it('che theo nhãn cho mọi định dạng key, không chỉ sk-', async () => {
    const error = await statusError('llm-qwen', res(401, JSON.stringify({ error: { message: 'invalid apikey=xoxb-abc123DEF456 supplied' } })))
    expect(error.message).not.toContain('xoxb-abc123DEF456')
  })

  it('vẫn che Bearer và sk- như cũ', async () => {
    const error = await statusError('llm-qwen', res(401, 'Authorization: Bearer sk-live-abcdefgh12345678 rejected'))
    expect(error.message).not.toContain('sk-live-abcdefgh12345678')
    expect(error.message).toContain('[redacted]')
  })

  it('không nuốt nội dung lỗi bình thường (vẫn debug được)', async () => {
    const error = await statusError('llm-qwen', res(400, JSON.stringify({ error: { message: 'model gpt-x does not exist' } })))
    expect(error.message).toContain('model gpt-x does not exist')
  })
})
