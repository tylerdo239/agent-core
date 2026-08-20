// seams/permission.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/permission-rbac (Phase 2).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    permission: PermissionService
  }
}

export abstract class PermissionService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'permission')
  }

  abstract check(actor: string, action: string): Promise<boolean>
}
