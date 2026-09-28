import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import pino from 'pino';
import type { Logger } from '../config/logger.js';
import { sha256 } from '../core/fingerprint.js';
import { createPool } from './pool.js';

const LOCK_ID = 728_341_900; // serializa migrations entre instancias do backend

/** db/migrations fica um nivel acima de backend/ (raiz do repositorio). */
function defaultMigrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../../db/migrations', import.meta.url));
}

export async function runMigrations(
  pool: Pool,
  logger: Logger,
  migrationsDir = defaultMigrationsDir(),
): Promise<string[]> {
  await pool.query(
    `create table if not exists schema_migrations (
       version    text primary key,
       checksum   text not null,
       applied_at timestamptz not null default now()
     )`,
  );

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = sha256(sql);
      const existing = await client.query<{ checksum: string }>(
        'select checksum from schema_migrations where version = $1',
        [file],
      );

      const previous = existing.rows[0];
      if (previous) {
        if (previous.checksum !== checksum) {
          throw new Error(`migration ${file} mudou depois de aplicada (checksum diferente); crie uma nova migration`);
        }
        continue;
      }

      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [file, checksum]);
        await client.query('commit');
        applied.push(file);
        logger.info({ migration: file }, 'migration aplicada');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]);
    client.release();
  }

  return applied;
}

// Execucao direta: npm run migrate (ou `node dist/db/migrate.js` no compose).
// O job so precisa de DATABASE_URL — nao carregamos o env completo para nao
// exigir a chave da IA em um container que nunca fala com a OpenRouter.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL nao definida.');
    process.exit(1);
  }

  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'satelite-migrate' } });
  const pool = createPool({ DATABASE_URL: connectionString, DATABASE_POOL_MAX: 2 }, logger);

  runMigrations(pool, logger)
    .then((applied) => {
      logger.info({ applied: applied.length }, applied.length ? 'migrations aplicadas' : 'banco ja atualizado');
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch(async (error) => {
      logger.error({ err: error }, 'falha ao aplicar migrations');
      await pool.end();
      process.exit(1);
    });
}
