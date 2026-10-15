import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createContainer } from './container.js';
import { createPool } from './db/pool.js';
import { startClassificationScheduler } from './scheduler/classification.scheduler.js';
import { startIngestionScheduler } from './scheduler/ingestion.scheduler.js';

const env = loadEnv();
const logger = createLogger(env);
const pool = createPool(env, logger);
const container = createContainer(env, logger, pool);

// Overrides do banco (tela /config-ia) entram ANTES de agendar e de servir:
// reload falho fica so no .env (o service ja trata sem derrubar o boot).
await container.settings.reload();

const app = createApp(container, logger);
const scheduler = startIngestionScheduler(container, logger);
let classificationScheduler = startClassificationScheduler(container, logger);

// Salvar na tela de config repara o agendador na hora: para o cron antigo e
// sobe o novo (presets do .env ou o que o usuario acabou de escolher).
container.settings.onApply(async () => {
  await classificationScheduler?.stop();
  classificationScheduler = startClassificationScheduler(container, logger);
  logger.info('agendador de classificacao recarregado apos mudanca de config');
});

const ai = container.settings.ai();
const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    { port: env.PORT, host: env.HOST, aiProvider: ai.provider, aiModel: ai.providers[ai.provider]?.model },
    `API no ar (${env.NODE_ENV})`,
  );
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'encerrando');

  // para de aceitar requisicoes e espera as em andamento antes de fechar o pool
  server.close();
  await scheduler?.stop();
  await classificationScheduler?.stop();
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
