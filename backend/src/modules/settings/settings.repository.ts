import type { Pool } from 'pg';

export type SettingsRepository = {
  /** Todos os grupos salvos: { chave -> objeto } (vazio = so .env). */
  all(): Promise<Record<string, unknown>>;
  upsert(key: string, value: unknown): Promise<void>;
};

export class PgSettingsRepository implements SettingsRepository {
  constructor(private readonly pool: Pool) {}

  async all(): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query<{ key: string; value: unknown }>(
      'select key, value from app_settings',
    );
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async upsert(key: string, value: unknown): Promise<void> {
    await this.pool.query(
      `insert into app_settings (key, value)
       values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
}
