// packages/ui-plugin-inventory/src/pluginApi.ts — fetch wrapper thẳng tới
// GET /plugins (bundles/adapters/api-rest, admin-gated action
// 'admin:plugins:view' — seams/plugin-inventory.ts). Cùng pattern
// parseErrorMessage/Bearer token đã dùng ở packages/ui-auth/src/authApi.ts.
export type PluginFiberState = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | 'disposed'

export interface PluginInventoryEntry {
  name: string
  category: 'provider' | 'tool' | 'skill' | 'loop-driver' | 'prompt' | 'adapter' | 'external'
  state: PluginFiberState
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') return body.error
  } catch {
    // body không phải JSON hợp lệ -- rơi xuống message chung bên dưới.
  }
  return `lỗi ${res.status}`
}

export async function listPlugins(restUrl: string, token: string): Promise<PluginInventoryEntry[]> {
  const res = await fetch(`${restUrl}/plugins`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  const { plugins } = (await res.json()) as { plugins: PluginInventoryEntry[] }
  return plugins
}
