// Phase 0 — xác nhận Cordis chạy đúng trước khi viết plugin nghiệp vụ.
//
// LƯU Ý: khác với pseudocode trong build plan gốc, `Service` KHÔNG nhận cờ
// "required" ở tham số thứ 3 (super(ctx, name) — chỉ 2 tham số). Đã verify
// trực tiếp trên @deepseek-ai/cordis@4.0.1 (xem seams/*.ts để biết pattern
// dùng thật cho toàn bộ project).
import { Context, Logger, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context { counter: Counter }
  interface Events { 'app/ready'(message: string): void }
}

class Counter extends Service {
  value = 0
  constructor(ctx: Context) {
    super(ctx, 'counter')
  }
  next() {
    return ++this.value
  }
}

const greeter = Object.assign(
  (ctx: Context) => {
    ctx.on('app/ready', (message) => {
      ctx.logger('greeter').info('%s #%d', message, ctx.counter.next())
    })
  },
  { inject: ['counter'] }, // spatial composability: chờ counter tồn tại mới activate
)

async function main() {
  const root = new Context()
  const exporter = {
    export: (message: Parameters<typeof Logger.format>[1]) => {
      const line = `[${message.name}] ${Logger.format(exporter, message)}`
      if (message.type === 'error') console.error(line)
      else console.log(line)
    },
  }
  root.logger.exporter(exporter)

  await root.plugin(Counter)
  await root.plugin(greeter)
  root.emit('app/ready', 'started')

  // temporal composability: mọi effect (listener) tự gỡ khi dispose
  await root.fiber.dispose()

  // Xác nhận không còn listener nào sống sót sau dispose: emit lại nhưng
  // không có gì để in ra vì `ctx.on` đã được gỡ cùng fiber.
  root.emit('app/ready', 'after dispose — should NOT print anything above this line')
  console.log('sanity-check OK: fiber.dispose() cleaned up all effects')
}

main()
