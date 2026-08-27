import { Context } from '@deepseek-ai/cordis'
import '../../../seams/skill.ts'
import '../../../seams/storage.ts'
import '../../../seams/tools.ts'
import '../../../seams/sessions.ts'

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`"${key}" must be a non-empty string`)
  return value
}

// 'sessions' KHÔNG nằm trong inject cứng -- soft-read qua ctx.get() (cùng
// pattern ctx.get('memory') ở loop-default, xem comment ở đó): tool-skill
// dùng ownerId của session CHỈ để lọc skill riêng-tư (mục 5,
// docs/agent-core-user-custom-skill-plan.md), không phải phụ thuộc bắt
// buộc -- ép inject cứng sẽ chặn apply() ở bất kỳ fixture/test nào mount
// tool-skill mà không mount session-registry (gap thật gặp phải: làm rỗng
// toàn bộ tool catalog trong tests/skill-semantic-discovery.test.ts).
export const inject = ['tools', 'skills', 'storage']

export const apply = (ctx: Context) => {
  ctx.tools.add({
    name: 'skill',
    description: [
      'Load the complete instructions and declared resource list for one available skill.',
      'Call this before acting when the user names a skill or the task clearly matches a skill description.',
      'Use the exact skill name from the skill catalog. Do not call it for unrelated tasks.',
    ].join(' '),
    parameters: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    },
    ui: { icon: '🧩', label: 'Nạp skill', summaryArg: 'name' },
    version: '1',
    async handler(args, invocation) {
      const name = requiredString(args, 'name')
      const ownerId = ctx.get('sessions')?.get(invocation.sessionId)?.ownerId
      const definition = ctx.skills.get(name, ownerId)
      if (!definition) {
        const available = ctx.skills.list({ topLevelOnly: true, visibleTo: ownerId }).map((item) => item.name)
        throw new Error(`skill "${name}" not found; available: ${available.join(', ')}`)
      }
      const event = { type: 'skill_loaded', source: invocation.source, activation: 'agent', skill: name }
      await ctx.storage.appendEvent(invocation.sessionId, event)
      ctx.emit('agent/step', {
        sessionId: invocation.sessionId,
        step: { type: 'skill_loaded', skill: name, activation: 'agent' },
      })
      return {
        name: definition.name,
        description: definition.description,
        instructions: definition.instructions,
        resources: definition.resources ?? [],
      }
    },
  })

  ctx.tools.add({
    name: 'read_skill_resource',
    description: 'Read one declared resource belonging to a loaded skill. Use the exact skill name and resource path returned by the `skill` tool.',
    parameters: {
      type: 'object',
      required: ['name', 'path'],
      properties: {
        name: { type: 'string', minLength: 1 },
        path: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    ui: { icon: '📖', label: 'Đọc tài liệu skill', summaryArg: 'path' },
    version: '1',
    async handler(args, invocation) {
      const name = requiredString(args, 'name')
      const resourcePath = requiredString(args, 'path')
      const ownerId = ctx.get('sessions')?.get(invocation.sessionId)?.ownerId
      const resource = await ctx.skills.readResource(name, resourcePath, ownerId)
      const event = {
        type: 'skill_resource', source: invocation.source,
        skill: name, path: resourcePath, encoding: resource.encoding,
      }
      await ctx.storage.appendEvent(invocation.sessionId, event)
      ctx.emit('agent/step', {
        sessionId: invocation.sessionId,
        step: { type: 'skill_resource', skill: name, path: resourcePath, encoding: resource.encoding },
      })
      return resource
    },
  })
}
