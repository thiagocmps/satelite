import { Pool } from 'pg';
import type { Logger } from '../config/logger.js';

/** O que o pool precisa do ambiente: o resto da config nao interfere aqui. */
export type DatabaseConfig = { DATABASE_URL: string; DATABASE_POOL_MAX?: number };

export function createPool(config: DatabaseConfig, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // conexoes ociosas quebradas nao derrubam o processo
  pool.on('error', (error) => logger.error({ err: error }, 'erro inesperado no pool do postgres'));
  return pool;
}

/** Superfino: os repositorios so precisam de `query`. */
export type Database = Pick<Pool, 'query'>;
