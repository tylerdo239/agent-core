import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as permissionRbac from '../bundles/providers/permission-rbac/index.ts'
import * as stateSqlite from '../bundles/providers/state-sqlite/index.ts'
import * as toolRegistry from '../bundles/providers/tool-registry/index.ts'
import { ToolExecutionError } from '../seams/tools.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

async function boot(rules: Record<string, string[]> = {}) {
  const root = new Context()
  root.plugin(stateSqlite, { path: ':memory:' })
  root.plugin(permissionRbac, { rules })
  root.plugin(toolRegistry)
  await settle()
  return root
}

describe('tool execution pipeline', () => {
  it('validates arguments before calling a handler', async () => {
    const root = await boot()
    let called = false
    root.tools.add({
      name: 'strict', description: 'strict tool',
      parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
      handler: async () => { called = true; return {} },
    })
    const error: any = await root.tools.invoke('strict', { value: 'wrong' }, { sessionId: 's', source: 'api' }).catch((value) => value)
    expect(error).toBeInstanceOf(ToolExecutionError)
    expect(error.code).toBe('TOOL_ARGS_INVALID')
    expect(called).toBe(false)
    await root.fiber.dispose()
  })

  it('keeps parameters optional for old plugins, but enforces declared permission', async () => {
    const root = await boot({ actor: ['read'] })
    root.tools.add({ name: 'legacy', description: 'legacy tool', handler: async (args) => args })
    root.tools.add({
      name: 'guarded', description: 'guarded tool', permissionActor: 'actor', permissionAction: 'write',
      handler: async () => 'unsafe',
    })
    await expect(root.tools.invoke('legacy', { any: true }, { sessionId: 's', source: 'api' })).resolves.toEqual({ any: true })
    const error: any = await root.tools.invoke('guarded', {}, { sessionId: 's', source: 'api' }).catch((value) => value)
    expect(error.code).toBe('TOOL_PERMISSION_DENIED')
    await root.fiber.dispose()
  })

  it('passes a cancellation signal to cooperative handlers and writes an audit event', async () => {
    const root = await boot()
    let sawAbort = false
    root.tools.add({
      name: 'slow', description: 'slow tool', timeoutMs: 20,
      handler: async (_args, context) => new Promise((_resolve, reject) => {
        context?.signal?.addEventListener('abort', () => {
          sawAbort = true
          reject(new Error('stopped'))
        }, { once: true })
      }),
    })
    const error: any = await root.tools.invoke('slow', {}, { sessionId: 's', source: 'api' }).catch((value) => value)
    expect(error.code).toBe('TOOL_TIMEOUT')
    expect(sawAbort).toBe(true)
    const audit = (await root.storage.readEvents('s')).find((event) => event.type === 'tool_audit')
    expect(audit).toMatchObject({ name: 'slow', outcome: 'timeout' })
    await root.fiber.dispose()
  })
})
