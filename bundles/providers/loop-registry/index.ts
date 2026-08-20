// bundles/loop-registry — provider cho seam ctx.loop.
// Cùng pattern effect-scoping với bundles/tool-registry — xem comment ở đó.
import { Context } from '@deepseek-ai/cordis'
import { LoopDriver, LoopRegistryService } from '../../../seams/loop.ts'

export class LoopRegistry extends LoopRegistryService {
  private drivers = new Map<string, LoopDriver>()

  register(name: string, driver: LoopDriver) {
    this.ctx.effect(() => {
      if (this.drivers.has(name)) {
        throw new Error(`loop driver "${name}" already registered`)
      }
      this.drivers.set(name, driver)
      this.ctx.logger('loop-registry').info('registered loop driver "%s"', name)
      return () => {
        this.drivers.delete(name)
        this.ctx.logger('loop-registry').info('unregistered loop driver "%s"', name)
      }
    }, `ctx.loop.register(${JSON.stringify(name)})`)
  }

  get(name: string) {
    return this.drivers.get(name)
  }

  has(name: string) {
    return this.drivers.has(name)
  }
}

export const apply = async (ctx: Context) => {
  await ctx.plugin(LoopRegistry)
}
