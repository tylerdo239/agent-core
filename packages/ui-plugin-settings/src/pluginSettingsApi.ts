// packages/ui-plugin-settings/src/pluginSettingsApi.ts — fetch wrapper thẳng
// tới GET/PUT/DELETE /plugin-settings + GET /tool-config-schema
// (bundles/adapters/api-rest, admin-gated action 'admin:plugins:configure' —
// seams/plugin-config.ts, seams/tools.ts). Cùng pattern
// parseErrorMessage/Bearer token đã dùng ở packages/ui-auth/src/authApi.ts.
async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') return body.error
  } catch {
    // body không phải JSON hợp lệ -- rơi xuống message chung bên dưới.
  }
  return `lỗi ${res.status}`
}

/** 1 field cấu hình do 1 tool ĐANG MOUNT thật tự khai (ToolDefinition.configSchema,
 * seams/tools.ts) — nguồn duy nhất cho "plugin nào cấu hình được", không còn
 * catalog hardcode ở tầng UI. Tool bên thứ 3 tự `ctx.tools.add()` với
 * `configSchema` cũng tự động xuất hiện qua endpoint này. */
export interface ConfigSchemaEntry {
  toolName: string
  key: string
  label: string
  description: string
}

export async function listConfigSchema(restUrl: string, token: string): Promise<ConfigSchemaEntry[]> {
  const res = await fetch(`${restUrl}/tool-config-schema`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  const { entries } = (await res.json()) as { entries: ConfigSchemaEntry[] }
  return entries
}

/** Danh sách KEY đang có giá trị lưu — KHÔNG bao giờ trả giá trị thật (secret không rời DB qua đường này). */
export async function listConfiguredKeys(restUrl: string, token: string): Promise<string[]> {
  const res = await fetch(`${restUrl}/plugin-settings`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  const { configured } = (await res.json()) as { configured: string[] }
  return configured
}

export async function savePluginSetting(restUrl: string, token: string, key: string, value: string): Promise<void> {
  const res = await fetch(`${restUrl}/plugin-settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function deletePluginSetting(restUrl: string, token: string, key: string): Promise<void> {
  const res = await fetch(`${restUrl}/plugin-settings/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
}
