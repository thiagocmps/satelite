import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createContainer } from './container.js';
import { createPool } from './db/pool.js';
import { startIngestionScheduler } from './scheduler/ingestion.scheduler.js';

const env = loadEnv();
const logger = createLogger(env);
const pool = createPool(env, logger);const container = createContainer(env, logger, pool);
const app = createApp(container, logger);
const scheduler = startIngestionScheduler(container, logger);

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT, host: env.HOST, aiModel: env.AI_MODEL }, `API no ar (${env.NODE_ENV})`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'encerrando');

  // para de aceitar requisicoes e espera as em andamento antes de fechar o pool
  server.close();
  await scheduler?.stop();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'promise rejeitada sem tratamento'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'excecao nao tratada; encerrando');
  void shutdown('uncaughtException');
});
