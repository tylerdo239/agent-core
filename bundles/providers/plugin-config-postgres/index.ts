// bundles/providers/plugin-config-postgres — provider cho seam
// ctx.pluginConfig. Dùng Postgres (cùng DATABASE_URL đã bắt buộc cho
// ctx.auth — xem bundles/providers/auth-users) — không thêm biến môi trường
// bắt buộc mới, mở pool RIÊNG (không dùng chung pool với auth-users) để 2
// provider độc lập vòng đời, đúng tinh thần spatial composability.
import { Context, Service } from '@deepseek-ai/cordis'
import pg from 'pg'
import { PluginConfigService } from '../../../seams/plugin-config.ts'

const { Pool } = pg

const CONNECT_RETRY_ATTEMPTS = 5
const CONNECT_RETRY_BASE_DELAY_MS = 500

export namespace PluginConfigPostgres {
  export interface Config {
    connectionString: string
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class PluginConfigPostgres extends PluginConfigService {
  private pool!: pg.Pool

  constructor(ctx: Context, public config: PluginConfigPostgres.Config) {
    super(ctx)
  }

  async [Service.init]() {
    this.pool = new Pool({ connectionString: this.config.connectionString })

    // Boot resilience — cùng lý do/pattern retry đã có ở auth-users
    // (pg_isready healthy không đảm bảo connection đầu tiên luôn thành công
    // ngay, race hẹp thật đã gặp).
    for (let attempt = 1; ; attempt++) {
      try {
        await this.pool.query('SELECT 1')
        break
      } catch (err) {
        if (attempt >= CONNECT_RETRY_ATTEMPTS) throw err
        this.ctx.logger('plugin-config-postgres').warn('kết nối Postgres thất bại (lần %d/%d), thử lại...', attempt, CONNECT_RETRY_ATTEMPTS)
        await sleep(CONNECT_RETRY_BASE_DELAY_MS * attempt)
      }
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS plugin_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    this.ctx.logger('plugin-config-postgres').info('connected (Postgres)')

    return async () => {
      await this.pool.end()
      this.ctx.logger('plugin-config-postgres').info('closed cleanly')
    }
  }

  async get(key: string): Promise<string | undefined> {
    const result = await this.pool.query('SELECT value FROM plugin_settings WHERE key = $1', [key])
    return result.rows[0]?.value
  }

  async set(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO plugin_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
    )
  }

  async delete(key: string): Promise<void> {
    await this.pool.query('DELETE FROM plugin_settings WHERE key = $1', [key])
  }

  async listConfiguredKeys(): Promise<string[]> {
    const result = await this.pool.query('SELECT key FROM plugin_settings ORDER BY key')
    return result.rows.map((row) => row.key)
  }
}

export const apply = async (ctx: Context, config: PluginConfigPostgres.Config) => {
  await ctx.plugin(PluginConfigPostgres, config)
}
