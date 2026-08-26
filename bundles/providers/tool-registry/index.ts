import { Context } from '@deepseek-ai/cordis'
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import '../../../seams/permission.ts'
import '../../../seams/storage.ts'
import {
  type ToolDefinition, ToolExecutionError,
  type ToolInvocationContext, ToolRegistryService,
} from '../../../seams/tools.ts'

const DEFAULT_TIMEOUT_MS = 30_000
const OPEN_OBJECT_SCHEMA = { type: 'object', additionalProperties: true }

export class ToolRegistry extends ToolRegistryService {
  private tools = new Map<string, ToolDefinition>()
  private validators = new WeakMap<Record<string, unknown>, ValidateFunction>()
  private ajv = new Ajv2020({ allErrors: true, strict: false })

  add(definition: ToolDefinition) {
    if (this.tools.has(definition.name)) throw new Error(`tool "${definition.name}" already registered`)
    try {
      this.validator(definition)
    } catch (error) {
      throw new Error(`tool "${definition.name}" has an invalid JSON Schema: ${(error as Error).message}`)
    }
    this.ctx.effect(() => {
      this.tools.set(definition.name, definition)
      this.ctx.logger('tool-registry').info('registered tool "%s"', definition.name)
      return () => this.tools.delete(definition.name)
    }, `ctx.tools.add(${JSON.stringify(definition.name)})`)
  }

  private validator(definition: ToolDefinition) {
    const schema = definition.parameters ?? OPEN_OBJECT_SCHEMA
    const cached = this.validators.get(schema)
    if (cached) return cached
    const compiled = this.ajv.compile(schema)
    this.validators.set(schema, compiled)
    return compiled
  }

  get(name: string) { return this.tools.get(name) }
  has(name: string) { return this.tools.has(name) }
  list() { return [...this.tools.values()] }

  async invoke(name: string, args: Record<string, unknown>, context: ToolInvocationContext): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) throw new ToolExecutionError('TOOL_NOT_FOUND', `tool "${name}" not found`, name)

    const validate = this.validator(tool)
    if (!validate(args)) {
      const details = (validate.errors ?? []).map(formatValidationError)
      throw new ToolExecutionError('TOOL_ARGS_INVALID', `tool "${name}" args invalid: ${details.join('; ')}`, name, details)
    }

    if (tool.permissionAction) {
      const permission = this.ctx.get('permission')
      const actor = tool.permissionActor ?? context.principal ?? tool.name
      const allowed = permission ? await permission.check(actor, tool.permissionAction).catch(() => false) : false
      if (!allowed) {
        throw new ToolExecutionError('TOOL_PERMISSION_DENIED', `tool "${name}" denied for actor "${actor}"`, name)
      }
    }

    if (context.signal?.aborted) throw new ToolExecutionError('TOOL_CANCELLED', `tool "${name}" cancelled`, name)
    if (context.deadline !== undefined && Date.now() >= context.deadline) {
      throw new ToolExecutionError('TOOL_TIMEOUT', `tool "${name}" skipped: deadline passed`, name)
    }

    const startedAt = Date.now()
    let outcome = 'ok'
    const timeoutMs = Math.max(1, Math.min(tool.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      context.deadline === undefined ? Number.POSITIVE_INFINITY : context.deadline - Date.now()))
    const controller = new AbortController()
    const cancel = () => controller.abort(context.signal?.reason ?? new Error('cancelled'))
    context.signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
    timer.unref?.()
    const effectiveContext: ToolInvocationContext = {
      ...context,
      deadline: Math.min(context.deadline ?? Number.POSITIVE_INFINITY, Date.now() + timeoutMs),
      signal: controller.signal,
    }

    try {
      const handler = Promise.resolve().then(() => tool.handler(args, effectiveContext))
      const aborted = new Promise<never>((_, reject) => {
        const fail = () => {
          const external = context.signal?.aborted
          reject(new ToolExecutionError(
            external ? 'TOOL_CANCELLED' : 'TOOL_TIMEOUT',
            external ? `tool "${name}" cancelled` : `tool "${name}" timed out after ${timeoutMs}ms`,
            name,
          ))
        }
        if (controller.signal.aborted) fail()
        else controller.signal.addEventListener('abort', fail, { once: true })
      })
      return await Promise.race([handler, aborted])
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        outcome = error.code === 'TOOL_TIMEOUT' ? 'timeout' : error.code === 'TOOL_CANCELLED' ? 'cancelled' : 'error'
        throw error
      }
      outcome = 'error'
      throw new ToolExecutionError('TOOL_HANDLER_ERROR', error instanceof Error ? error.message : String(error), name)
    } finally {
      clearTimeout(timer)
      context.signal?.removeEventListener('abort', cancel)
      await this.audit(tool, args, context, outcome, Date.now() - startedAt)
    }
  }

  private async audit(tool: ToolDefinition, args: Record<string, unknown>, context: ToolInvocationContext, outcome: string, durationMs: number) {
    const storage = this.ctx.get('storage')
    if (!storage) return
    try {
      await storage.appendEvent(context.sessionId, {
        type: 'tool_audit', name: tool.name, version: tool.version ?? '0',
        source: context.source, runId: context.runId, jobId: context.jobId,
        principal: context.principal, outcome, durationMs, argsSummary: Object.keys(args),
      })
    } catch (error) {
      this.ctx.logger('tool-registry').warn('audit event dropped for "%s": %s', tool.name, String(error))
    }
  }
}

function formatValidationError(error: ErrorObject) {
  return `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`
}

export const apply = async (ctx: Context) => { await ctx.plugin(ToolRegistry) }
