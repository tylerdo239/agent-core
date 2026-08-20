// bundles/api-grpc — Phase 6.3: gRPC adapter mỏng, mirror REST + tương đương
// WS streaming qua server-streaming RPC. Build khi cần polyglot/service-to-
// service (xem docs/agent-core-cordis-build-plan.md Phase 6.3) — không bắt
// buộc cho web/mobile client, REST + WS đã đủ.
//
// Cùng nguyên tắc lifecycle (coding rule A13: apply async, return disposer
// trực tiếp) và cùng nguyên tắc không-đăng-ký-vào-registry-khác (rule A12
// không áp dụng — bundle sở hữu server của chính nó) như api-rest/api-ws.
//
// Production hardening: auth qua metadata `authorization: Bearer <key>` —
// check ở ĐẦU mỗi handler (gRPC không có middleware chuẩn đơn giản cho cả
// unary lẫn streaming, check inline rõ ràng hơn tự chế interceptor phức
// tạp). Giới hạn kích thước message nhận vào qua server option.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { Context } from '@deepseek-ai/cordis'
import '../../../seams/sessions.ts'
import '../../../seams/agent.ts'
import '../../../seams/auth.ts'
import { LoopStep } from '../../../seams/loop.ts'

export namespace ApiGrpc {
  export interface Config {
    /** 0 = để OS tự chọn cổng trống (dùng trong test); mặc định 50051 (convention gRPC) cho chạy tay. */
    port?: number
    /** Giới hạn message nhận vào (byte) — mặc định 4 MiB (mặc định gốc của gRPC). */
    maxReceiveMessageBytes?: number
  }
}

export const inject = ['sessions', 'agent', 'auth']

const DEFAULT_MAX_RECEIVE_MESSAGE_BYTES = 4 * 1024 * 1024 // 4 MiB

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTO_PATH = path.join(__dirname, 'agent.proto')

function stepToProto(sessionId: string, step: LoopStep) {
  const base = {
    session_id: sessionId,
    type: step.type,
    content: '',
    tool_call_name: '',
    tool_call_args_json: '',
    tool_result_name: '',
    tool_result_json: '',
    // Phase 8.5: cùng metadata `toolUi` mà WS forward qua `step.toolUi` —
    // giữ 3 adapter đồng nhất, không để WS là adapter duy nhất mang được.
    tool_ui_json: '',
  }
  if (step.type === 'model_message') {
    return {
      ...base,
      content: step.content,
      tool_call_name: step.toolCall?.name ?? '',
      tool_call_args_json: step.toolCall ? JSON.stringify(step.toolCall.args) : '',
      tool_ui_json: step.toolUi ? JSON.stringify(step.toolUi) : '',
    }
  }
  if (step.type === 'tool_result') {
    return { ...base, tool_result_name: step.name, tool_result_json: JSON.stringify(step.result), tool_ui_json: step.toolUi ? JSON.stringify(step.toolUi) : '' }
  }
  // critic_message | final
  return { ...base, content: step.content }
}

function extractBearerToken(metadata: grpc.Metadata): string | undefined {
  const header = metadata.get('authorization')[0]
  const value = typeof header === 'string' ? header : header?.toString('utf8')
  if (!value?.startsWith('Bearer ')) return undefined
  return value.slice('Bearer '.length)
}

export const apply = async (ctx: Context, config: ApiGrpc.Config = {}) => {
  // keepCase: true — giữ nguyên snake_case như định nghĩa trong .proto, khớp
  // với field name dùng xuyên suốt file này (message.max_steps, không phải
  // maxSteps). Mặc định proto-loader tự chuyển sang camelCase nếu để false —
  // gây bug thật khi build (field đọc/ghi sai tên, âm thầm undefined).
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  const proto = grpc.loadPackageDefinition(packageDef) as any

  const server = new grpc.Server({
    'grpc.max_receive_message_length': config.maxReceiveMessageBytes ?? DEFAULT_MAX_RECEIVE_MESSAGE_BYTES,
  })
  server.addService(proto.agentcore.AgentService.service, {
    createSession: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      if (!ctx.auth.verify(extractBearerToken(call.metadata))) {
        return callback({ code: grpc.status.UNAUTHENTICATED, message: 'unauthorized' })
      }
      try {
        const req = call.request
        const session = ctx.sessions.create({
          id: req.id || undefined,
          driver: req.driver || undefined,
          maxSteps: req.max_steps || undefined,
          systemPrompt: req.system_prompt || undefined,
        })
        callback(null, { id: session.id, driver: session.driver, max_steps: session.maxSteps })
      } catch (err: any) {
        callback({ code: grpc.status.INTERNAL, message: err.message })
      }
    },

    sendMessage: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      if (!ctx.auth.verify(extractBearerToken(call.metadata))) {
        return callback({ code: grpc.status.UNAUTHENTICATED, message: 'unauthorized' })
      }
      const req = call.request
      const session = ctx.sessions.get(req.session_id)
      if (!session) {
        return callback({ code: grpc.status.NOT_FOUND, message: `session "${req.session_id}" not found` })
      }
      try {
        const driver = req.driver || session.driver
        const result = await ctx.agent.runTurn(driver, session, req.message)
        callback(null, result)
      } catch (err: any) {
        callback({ code: grpc.status.INTERNAL, message: err.message })
      }
    },

    streamTurn: async (call: grpc.ServerWritableStream<any, any>) => {
      if (!ctx.auth.verify(extractBearerToken(call.metadata))) {
        call.destroy(Object.assign(new Error('unauthorized'), { code: grpc.status.UNAUTHENTICATED }))
        return
      }
      const req = call.request
      const session = ctx.sessions.get(req.session_id)
      if (!session) {
        call.destroy(Object.assign(new Error(`session "${req.session_id}" not found`), { code: grpc.status.NOT_FOUND }))
        return
      }

      const unsub = ctx.on('agent/step', (event: { sessionId: string; step: LoopStep }) => {
        if (event.sessionId !== req.session_id) return
        call.write(stepToProto(event.sessionId, event.step))
      })

      try {
        const driver = req.driver || session.driver
        await ctx.agent.runTurn(driver, session, req.message)
        call.end()
      } catch (err: any) {
        call.destroy(Object.assign(new Error(err.message), { code: grpc.status.INTERNAL }))
      } finally {
        unsub()
      }
    },
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${config.port ?? 50051}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) reject(err)
      else resolve(boundPort)
    })
  })
  config.port = port
  ctx.logger('api-grpc').info('listening on :%d', port)

  return () => new Promise<void>((resolve) => server.tryShutdown(() => resolve()))
}
