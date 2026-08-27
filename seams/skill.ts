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
  /** undefined = skill global (built-in, mọi user thấy). Có giá trị = skill riêng do 1 user tự thêm — chỉ user đó (và admin) thấy được, xem SkillListOptions.visibleTo. */
  ownerId?: string
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
  /** userId của caller. Khi set: ẩn skill có `ownerId` khác giá trị này (skill global — `ownerId` undefined — luôn hiện). Không set = chỉ thấy skill global. */
  visibleTo?: string
}

export abstract class SkillRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'skills')
  }

  /**
   * Đăng ký 1 skill BUILD-TIME (global, `ownerId` không được set ở đây — dùng
   * `upsert()` cho skill có chủ). Cùng ràng buộc effect-scoping như
   * ToolRegistryService.add/SubagentRegistryService.register — implementation
   * PHẢI gắn disposer qua `ctx.effect()` để tự gỡ đúng fiber gọi.
   */
  abstract register(def: SkillDefinition, readResource?: SkillResourceReader): void
  /**
   * Thêm/ghi đè 1 skill có `ownerId` — KHÔNG effect-scoped (vòng đời do caller
   * tự quản lý qua CRUD riêng, vd. ctx.customSkills — xem
   * seams/custom-skills.ts), khác hẳn `register()`. Dùng khi caller không
   * chạy trong 1 fiber plugin sống lâu dài (vd. handler REST). Ghi đè nếu
   * cùng `(ownerId, name)` đã tồn tại (edit).
   */
  abstract upsert(def: SkillDefinition, readResource?: SkillResourceReader): void
  /** Gỡ 1 skill có chủ theo đúng `(ownerId, name)`. Trả `true` nếu đã xoá, `false` nếu không tìm thấy. Không dùng để gỡ skill global (không có ownerId). */
  abstract remove(name: string, ownerId: string): boolean
  abstract get(name: string, visibleTo?: string): SkillDefinition | undefined
  abstract has(name: string, ownerId?: string): boolean
  abstract list(options?: SkillListOptions): SkillDefinition[]
  /** Trả về các skill có ≥1 trigger khớp userMessage; semantic discovery do model + tool `skill` thực hiện. */
  abstract match(userMessage: string, visibleTo?: string): SkillDefinition[]
  abstract readResource(skillName: string, resourcePath: string, visibleTo?: string): Promise<SkillResourceContent>
}
