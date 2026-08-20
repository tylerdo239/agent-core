// Phase 0 deliverable, dạng automated test (thay vì chỉ chạy tay src/sanity-check.ts):
// fiber.dispose() phải gỡ sạch mọi effect (listener) — emit lại sau dispose
// không còn gọi tới listener nào.
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'

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

describe('Phase 0 sanity check', () => {
  it('temporal composability: fiber.dispose() gỡ sạch listener đã đăng ký qua ctx.on', async () => {
    const root = new Context()
    let calls = 0

    const greeter = Object.assign(
      (ctx: Context) => {
        ctx.on('app/ready', () => {
          calls++
          ctx.counter.next()
        })
      },
      { inject: ['counter'] },
    )

    await root.plugin(Counter)
    await root.plugin(greeter)

    root.emit('app/ready', 'started')
    expect(calls).toBe(1)
    expect(root.counter.value).toBe(1)

    await root.fiber.dispose()

    root.emit('app/ready', 'after dispose')
    expect(calls).toBe(1) // không tăng thêm — listener đã bị gỡ sạch
  })
})
