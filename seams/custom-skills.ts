// seams/custom-skills.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/providers/custom-skill-store-postgres.
//
// Sở hữu nghiệp vụ "user tự thêm skill riêng" (persistence + ownership +
// validate) — TÁCH khỏi ctx.skills (seams/skill.ts), vốn cố tình chỉ là
// catalog/runtime thuần (coding rule A6, cùng lý do ctx.pluginConfig không
// biết "key nào hợp lệ" — xem comment ở seams/plugin-config.ts). Provider
// của seam này gọi ctx.skills.upsert()/remove() để đồng bộ runtime ngay khi
// CRUD, không cần restart service (xem docs/agent-core-user-custom-skill-plan.md).
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customSkills: CustomSkillStoreService
  }
}

export interface CustomSkillInput {
  /** Slug — /^[a-z0-9][a-z0-9-]{1,63}$/, duy nhất trong phạm vi 1 owner (không phải toàn hệ thống). */
  name: string
  description: string
  /** Nội dung file .md — chèn thẳng vào system prompt khi skill kích hoạt. */
  instructions: string
  triggers: string[]
}

export interface CustomSkillRecord extends CustomSkillInput {
  ownerId: string
  createdAt: string
  updatedAt: string
}

export abstract class CustomSkillStoreService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'customSkills')
  }

  abstract create(ownerId: string, input: CustomSkillInput): Promise<CustomSkillRecord>
  abstract update(ownerId: string, name: string, input: CustomSkillInput): Promise<CustomSkillRecord>
  abstract delete(ownerId: string, name: string): Promise<void>
  abstract listByOwner(ownerId: string): Promise<CustomSkillRecord[]>
  /** Admin-only moderation — toàn bộ skill custom, mọi owner. */
  abstract listAll(): Promise<CustomSkillRecord[]>
}
