// bundles/permission-rbac — provider cho seam ctx.permission (Phase 2).
//
// RBAC tối giản: config liệt kê action nào mỗi actor được phép làm.
// Mặc định deny — không có rule tường minh nghĩa là từ chối (an toàn hơn
// allow-by-default cho 1 permission service).
import { Context } from '@deepseek-ai/cordis'
import { PermissionService } from '../../../seams/permission.ts'

export namespace PermissionRbac {
  export interface Config {
    rules?: Record<string, string[]>
  }
}

export class PermissionRbac extends PermissionService {
  private rules: Record<string, string[]>

  constructor(ctx: Context, public config: PermissionRbac.Config = {}) {
    super(ctx)
    this.rules = config.rules ?? {}
    this.ctx.logger('permission-rbac').info('loaded %d actor rule(s)', Object.keys(this.rules).length)
  }

  async check(actor: string, action: string) {
    const allowed = this.rules[actor] ?? []
    const granted = allowed.includes(action) || allowed.includes('*')
    this.ctx.logger('permission-rbac').debug('check(%s, %s) -> %s', actor, action, granted)
    return granted
  }
}

export const apply = async (ctx: Context, config: PermissionRbac.Config = {}) => {
  await ctx.plugin(PermissionRbac, config)
}
