// src/extra-plugins.ts — parse EXTRA_PLUGINS / EXTRA_PLUGIN_CONFIG__<name>
// (docs/agent-core-adding-plugins.md). Hàm thuần, THROW Error trên input
// sai (không tự process.exit — src/serve.ts là composition root, tự bọc
// FATAL + process.exit(1) ở call site, cùng pattern src/env.ts đã có).
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export interface ExtraPluginEntry {
  readonly name: string
  readonly specifier: string
}

/**
 * Parse `EXTRA_PLUGINS="name:specifier,name:specifier,..."`.
 *
 * `specifier` bắt đầu bằng "."/"/" -> resolve tương đối `agentCoreRoot`
 * (plugin local chưa publish); ngược lại giữ nguyên làm bare npm package
 * specifier, Node tự resolve qua node_modules lúc `import()`.
 */
export function parseExtraPlugins(raw: string | undefined, agentCoreRoot: string): ExtraPluginEntry[] {
  if (!raw) return []
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separatorIndex = entry.indexOf(':')
    const name = separatorIndex === -1 ? '' : entry.slice(0, separatorIndex)
    const specifier = separatorIndex === -1 ? '' : entry.slice(separatorIndex + 1)
    if (!name || !specifier) {
      throw new Error(`EXTRA_PLUGINS entry "${entry}" sai format — cần đúng "name:specifier".`)
    }
    const resolved = specifier.startsWith('.') || specifier.startsWith('/')
      ? pathToFileURL(path.resolve(agentCoreRoot, specifier)).href
      : specifier
    return { name, specifier: resolved }
  })
}

/** Parse `EXTRA_PLUGIN_CONFIG__<name>` (JSON). `undefined` khi không set — plugin tự đọc process.env. */
export function extraPluginConfig(raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  return JSON.parse(raw)
}

/** Module dynamic-import có đúng hình dạng plugin Cordis chấp nhận (object/class/function plugin) không. */
export function isPluginModule(mod: unknown): boolean {
  return typeof mod === 'object' && mod !== null && ('apply' in mod || 'default' in mod)
}
