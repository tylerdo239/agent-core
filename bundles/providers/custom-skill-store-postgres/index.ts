// bundles/providers/custom-skill-store-postgres — provider cho seam
// ctx.customSkills. Cùng pattern bundles/providers/plugin-config-postgres
// (pool Postgres RIÊNG, cùng DATABASE_URL đã bắt buộc cho ctx.auth — không
// thêm biến môi trường bắt buộc mới, retry-with-backoff boot y hệt).
//
// Khác pluginConfig ở chỗ CẦN đồng bộ ngay vào ctx.skills (in-memory, đọc
// mỗi turn) sau mỗi lần ghi Postgres — dùng ctx.skills.upsert()/remove(),
// KHÔNG dùng ctx.skills.register() (effect-scoped, không phù hợp vòng đời
// "CRUD qua HTTP route", xem seams/skill.ts + docs/agent-core-user-custom-skill-plan.md
// mục 1-2). Lúc boot (Service.init), warm lại toàn bộ row đã lưu vào
// ctx.skills — skill user tự thêm sống sót qua restart/redeploy, không chỉ
// CRUD runtime.
import { Context, Service } from '@deepseek-ai/cordis'
import pg from 'pg'
import { CustomSkillInput, CustomSkillRecord, CustomSkillStoreService } from '../../../seams/custom-skills.ts'
import { SkillDefinition } from '../../../seams/skill.ts'
import '../../../seams/skill.ts'

const { Pool } = pg

const CONNECT_RETRY_ATTEMPTS = 5
const CONNECT_RETRY_BASE_DELAY_MS = 500
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/
const MAX_DESCRIPTION_LENGTH = 280
const MAX_INSTRUCTIONS_BYTES = 64 * 1024
const MAX_TRIGGERS = 20
const MAX_TRIGGER_LENGTH = 64
const MAX_SKILLS_PER_OWNER = 50

export namespace CustomSkillStorePostgres {
  export interface Config {
    connectionString: string
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function validate(input: CustomSkillInput) {
  if (!NAME_PATTERN.test(input.name)) {
    throw httpError('"name" phải khớp /^[a-z0-9][a-z0-9-]{1,63}$/ (chữ thường/số/gạch ngang)', 400)
  }
  if (!input.description.trim() || input.description.length > MAX_DESCRIPTION_LENGTH) {
    throw httpError(`"description" không được rỗng và tối đa ${MAX_DESCRIPTION_LENGTH} ký tự`, 400)
  }
  if (!input.instructions.trim()) {
    throw httpError('"instructions" không được rỗng', 400)
  }
  if (Buffer.byteLength(input.instructions, 'utf8') > MAX_INSTRUCTIONS_BYTES) {
    throw httpError(`"instructions" vượt giới hạn ${MAX_INSTRUCTIONS_BYTES} byte`, 400)
  }
  if (!Array.isArray(input.triggers) || input.triggers.length > MAX_TRIGGERS) {
    throw httpError(`tối đa ${MAX_TRIGGERS} trigger`, 400)
  }
  if (input.triggers.some((t) => typeof t !== 'string' || t.length > MAX_TRIGGER_LENGTH)) {
    throw httpError(`mỗi trigger tối đa ${MAX_TRIGGER_LENGTH} ký tự`, 400)
  }
}

function toRecord(row: any): CustomSkillRecord {
  return {
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    triggers: JSON.parse(row.triggers),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }
}

function toSkillDefinition(record: CustomSkillRecord): SkillDefinition {
  return {
    name: record.name,
    description: record.description,
    instructions: record.instructions,
    triggers: record.triggers,
    userInvocable: true,
    ownerId: record.ownerId,
  }
}

export class CustomSkillStorePostgres extends CustomSkillStoreService {
  private pool!: pg.Pool

  constructor(ctx: Context, public config: CustomSkillStorePostgres.Config) {
    super(ctx)
  }

  async [Service.init]() {
    this.pool = new Pool({ connectionString: this.config.connectionString })

    // Boot resilience — cùng pattern retry đã có ở auth-users/plugin-config-postgres.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.pool.query('SELECT 1')
        break
      } catch (err) {
        if (attempt >= CONNECT_RETRY_ATTEMPTS) throw err
        this.ctx.logger('custom-skill-store-postgres').warn('kết nối Postgres thất bại (lần %d/%d), thử lại...', attempt, CONNECT_RETRY_ATTEMPTS)
        await sleep(CONNECT_RETRY_BASE_DELAY_MS * attempt)
      }
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS custom_skills (
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        instructions TEXT NOT NULL,
        triggers TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_id, name)
      )
    `)
    this.ctx.logger('custom-skill-store-postgres').info('connected (Postgres)')

    // Warm ctx.skills từ dữ liệu đã lưu — skill user tự thêm sống sót qua
    // restart/redeploy container, không chỉ CRUD lúc đang chạy.
    const { rows } = await this.pool.query('SELECT * FROM custom_skills')
    for (const row of rows) {
      this.ctx.skills.upsert(toSkillDefinition(toRecord(row)))
    }
    this.ctx.logger('custom-skill-store-postgres').info('warmed %d custom skill(s) into ctx.skills', rows.length)

    return async () => {
      await this.pool.end()
      this.ctx.logger('custom-skill-store-postgres').info('closed cleanly')
    }
  }

  async create(ownerId: string, input: CustomSkillInput): Promise<CustomSkillRecord> {
    validate(input)
    const { rows: countRows } = await this.pool.query('SELECT count(*)::int AS n FROM custom_skills WHERE owner_id = $1', [ownerId])
    if (countRows[0].n >= MAX_SKILLS_PER_OWNER) {
      throw httpError(`đã đạt giới hạn ${MAX_SKILLS_PER_OWNER} skill/user`, 409)
    }
    const { rows: existing } = await this.pool.query('SELECT 1 FROM custom_skills WHERE owner_id = $1 AND name = $2', [ownerId, input.name])
    if (existing.length) throw httpError(`skill "${input.name}" đã tồn tại`, 409)

    const { rows } = await this.pool.query(
      `INSERT INTO custom_skills (owner_id, name, description, instructions, triggers, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING *`,
      [ownerId, input.name, input.description, input.instructions, JSON.stringify(input.triggers)],
    )
    const record = toRecord(rows[0])
    this.ctx.skills.upsert(toSkillDefinition(record))
    return record
  }

  async update(ownerId: string, name: string, input: CustomSkillInput): Promise<CustomSkillRecord> {
    if (input.name !== name) throw httpError('"name" trong body phải khớp tên trên URL (không đổi tên qua update)', 400)
    validate(input)
    const { rows } = await this.pool.query(
      `UPDATE custom_skills SET description = $3, instructions = $4, triggers = $5, updated_at = now()
       WHERE owner_id = $1 AND name = $2 RETURNING *`,
      [ownerId, name, input.description, input.instructions, JSON.stringify(input.triggers)],
    )
    if (!rows.length) throw httpError(`skill "${name}" không tồn tại`, 404)
    const record = toRecord(rows[0])
    this.ctx.skills.upsert(toSkillDefinition(record))
    return record
  }

  async delete(ownerId: string, name: string): Promise<void> {
    const result = await this.pool.query('DELETE FROM custom_skills WHERE owner_id = $1 AND name = $2', [ownerId, name])
    if (!result.rowCount) throw httpError(`skill "${name}" không tồn tại`, 404)
    this.ctx.skills.remove(name, ownerId)
  }

  async listByOwner(ownerId: string): Promise<CustomSkillRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM custom_skills WHERE owner_id = $1 ORDER BY name', [ownerId])
    return rows.map(toRecord)
  }

  async listAll(): Promise<CustomSkillRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM custom_skills ORDER BY owner_id, name')
    return rows.map(toRecord)
  }
}

export const inject = ['skills']

export const apply = async (ctx: Context, config: CustomSkillStorePostgres.Config) => {
  await ctx.plugin(CustomSkillStorePostgres, config)
}
