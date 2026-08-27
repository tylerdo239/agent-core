// packages/ui-skill-manager/src/customSkillApi.ts — fetch wrapper thẳng tới
// GET/POST/PUT/DELETE /custom-skills (bundles/adapters/api-rest, sở hữu
// chính mình qua identity.userId — seams/custom-skills.ts). Cùng pattern
// parseErrorMessage/Bearer token đã dùng ở packages/ui-plugin-settings/src/pluginSettingsApi.ts.
async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') return body.error
  } catch {
    // body không phải JSON hợp lệ -- rơi xuống message chung bên dưới.
  }
  return `lỗi ${res.status}`
}

export interface CustomSkill {
  name: string
  description: string
  instructions: string
  triggers: string[]
  createdAt: string
  updatedAt: string
}

export interface CustomSkillInput {
  name: string
  description: string
  instructions: string
  triggers: string[]
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` }
}

export async function listCustomSkills(restUrl: string, token: string): Promise<CustomSkill[]> {
  const res = await fetch(`${restUrl}/custom-skills`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  const { skills } = (await res.json()) as { skills: CustomSkill[] }
  return skills
}

export async function createCustomSkill(restUrl: string, token: string, input: CustomSkillInput): Promise<CustomSkill> {
  const res = await fetch(`${restUrl}/custom-skills`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  return res.json()
}

export async function updateCustomSkill(restUrl: string, token: string, name: string, input: CustomSkillInput): Promise<CustomSkill> {
  const res = await fetch(`${restUrl}/custom-skills/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
  return res.json()
}

export async function deleteCustomSkill(restUrl: string, token: string, name: string): Promise<void> {
  const res = await fetch(`${restUrl}/custom-skills/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(await parseErrorMessage(res))
}
