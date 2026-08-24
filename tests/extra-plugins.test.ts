// tests/extra-plugins.test.ts — EXTRA_PLUGINS (docs/agent-core-adding-plugins.md):
// bên thứ ba thêm 1 plugin mà KHÔNG sửa src/serve.ts. Test 2 lớp: (1) hàm
// thuần trong src/extra-plugins.ts — parse format/JSON, fail đúng cách; (2)
// tích hợp THẬT — dynamic import() 1 fixture plugin thật, mount qua Cordis
// thật, xác nhận tool nó đăng ký hoạt động được, không phải giả lập.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { extraPluginConfig, isPluginModule, parseExtraPlugins } from '../src/extra-plugins.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'

const agentCoreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
}

describe('parseExtraPlugins', () => {
  it('undefined/rỗng -> mảng rỗng', () => {
    expect(parseExtraPlugins(undefined, agentCoreRoot)).toEqual([])
    expect(parseExtraPlugins('', agentCoreRoot)).toEqual([])
  })

  it('bare npm specifier -> giữ nguyên, không resolve path', () => {
    expect(parseExtraPlugins('my-tool:@myorg/agent-core-plugin-my-tool', agentCoreRoot)).toEqual([
      { name: 'my-tool', specifier: '@myorg/agent-core-plugin-my-tool' },
    ])
  })

  it('specifier bắt đầu bằng "." -> resolve thành file:// URL tương đối agentCoreRoot', () => {
    const [entry] = parseExtraPlugins('my-tool:./tests/fixtures/extra-plugin-sample/index.ts', agentCoreRoot)
    expect(entry.name).toBe('my-tool')
    expect(entry.specifier).toBe(
      pathToFileURL(path.join(agentCoreRoot, 'tests/fixtures/extra-plugin-sample/index.ts')).href,
    )
  })

  it('nhiều entry phân tách bởi dấu phẩy, có khoảng trắng thừa -> parse đúng từng cái', () => {
    const entries = parseExtraPlugins(' a:pkg-a , b:pkg-b ', agentCoreRoot)
    expect(entries).toEqual([
      { name: 'a', specifier: 'pkg-a' },
      { name: 'b', specifier: 'pkg-b' },
    ])
  })

  it('thiếu dấu ":" hoặc thiếu name/specifier -> throw rõ ràng', () => {
    expect(() => parseExtraPlugins('no-colon-here', agentCoreRoot)).toThrow('sai format')
    expect(() => parseExtraPlugins(':missing-name', agentCoreRoot)).toThrow('sai format')
    expect(() => parseExtraPlugins('missing-specifier:', agentCoreRoot)).toThrow('sai format')
  })
})

describe('extraPluginConfig', () => {
  it('undefined -> undefined (plugin tự đọc process.env)', () => {
    expect(extraPluginConfig(undefined)).toBeUndefined()
  })

  it('JSON hợp lệ -> parse đúng', () => {
    expect(extraPluginConfig('{"apiKey":"x"}')).toEqual({ apiKey: 'x' })
  })

  it('JSON không hợp lệ -> throw', () => {
    expect(() => extraPluginConfig('{not json')).toThrow()
  })
})

describe('isPluginModule', () => {
  it('object có "apply" -> true', () => {
    expect(isPluginModule({ apply: () => {} })).toBe(true)
  })

  it('object có "default" -> true', () => {
    expect(isPluginModule({ default: () => {} })).toBe(true)
  })

  it('object không có apply lẫn default -> false', () => {
    expect(isPluginModule({ foo: 'bar' })).toBe(false)
  })

  it('null/không phải object -> false', () => {
    expect(isPluginModule(null)).toBe(false)
    expect(isPluginModule('a string')).toBe(false)
    expect(isPluginModule(undefined)).toBe(false)
  })
})

describe('EXTRA_PLUGINS — tích hợp thật: dynamic import() + mount qua Cordis thật', () => {
  it('nạp fixture plugin qua path tương đối, tool nó đăng ký hoạt động được', async () => {
    const [entry] = parseExtraPlugins('sample:./tests/fixtures/extra-plugin-sample/index.ts', agentCoreRoot)

    const root = new Context()
    root.plugin(toolRegistry)
    await settle()

    const mod: unknown = await import(entry.specifier)
    expect(isPluginModule(mod)).toBe(true)
    root.plugin(mod as any, { greeting: 'chào' })
    await settle()

    expect(root.tools.has('extra_plugin_sample_tool')).toBe(true)
    const result = await root.tools.invoke('extra_plugin_sample_tool', {}, { sessionId: 's1', source: 'default-loop' })
    expect(result).toEqual({ message: 'chào from extra plugin' })
  })
})
