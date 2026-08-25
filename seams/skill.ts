// seams/skill.ts — Service Definition. KHÔNG chứa implementation.
// Provider thật: bundles/providers/skill-registry.
//
// Khác `ctx.tools` (hàm model TỰ GỌI qua tool-calling giữa turn) và
// `ctx.subagents` (uỷ thác 1 task cho 1 lượt chạy TÁCH BIỆT): "skill" là 1
// gói HƯỚNG DẪN TĨNH. Registry quản lý catalog/resource; plugin
// tool-skill quảng bá catalog để model tự chọn theo ngữ nghĩa và nạp full
// instructions. `match()` chỉ là fast path tất định cho trigger rõ ràng.
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skills: SkillRegistryService
  }
}

export interface SkillDefinition {
  name: string
  description: string
  /** Nội dung chèn vào system prompt (dạng 1 message role 'system' riêng) khi skill được kích hoạt. */
  instructions: string
  /** Từ khoá kích hoạt, so khớp substring không phân biệt hoa/thường trên tin nhắn user. Rỗng = không bao giờ tự kích hoạt qua match(). */
  triggers: string[]
  /** Có thể được UI/API chọn trực tiếp cho một turn. Resource con luôn false. */
  userInvocable?: boolean
  /** Resource thuộc package; resource không bị đăng ký giả thành skill con. */
  resources?: SkillResource[]
}

export type SkillResourceKind = 'asset' | 'reference' | 'checklist' | 'script' | 'template'

export interface SkillResource {
  path: string
  kind: SkillResourceKind
}

export interface SkillResourceContent extends SkillResource {
  content: string
  encoding: 'utf8' | 'base64'
}

export type SkillResourceReader = (path: string) => Promise<SkillResourceContent>

export interface SkillListOptions {
  userInvocableOnly?: boolean
  topLevelOnly?: boolean
}

export abstract class SkillRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'skills')
  }

  /**
   * Đăng ký 1 skill. Cùng ràng buộc effect-scoping như
   * ToolRegistryService.add/SubagentRegistryService.register — implementation
   * PHẢI gắn disposer qua `ctx.effect()` để tự gỡ đúng fiber gọi.
   */
  abstract register(def: SkillDefinition, readResource?: SkillResourceReader): void
  abstract get(name: string): SkillDefinition | undefined
  abstract has(name: string): boolean
  abstract list(options?: SkillListOptions): SkillDefinition[]
  /** Trả về các skill có ≥1 trigger khớp userMessage; semantic discovery do model + tool `skill` thực hiện. */
  abstract match(userMessage: string): SkillDefinition[]
  abstract readResource(skillName: string, resourcePath: string): Promise<SkillResourceContent>
}
