import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from '../config/logger.js';
import type { Container } from '../container.js';

/**
 * Agenda a ingestao periodica. Desligue com ENABLE_INGEST=false (ex.: quando
 * outra instancia ou um job externo ja ingerem).
 */
export function startIngestionScheduler(container: Container, logger: Logger): ScheduledTask | null {
  const { env } = container;

  if (!env.ENABLE_INGEST) {
    logger.info('agendador de ingestao desabilitado (ENABLE_INGEST=false)');
    return null;
  }
  if (!cron.validate(env.INGEST_CRON)) {
    throw new Error(`INGEST_CRON invalido: "${env.INGEST_CRON}" (use expressao cron de 5 campos)`);
  }

  const task = cron.schedule(
    env.INGEST_CRON,
    async () => {
      if (container.ingestion.isRunning) {
        logger.warn('ingestao anterior ainda em andamento; ciclo ignorado');
        return;
      }
      try {
        const report = await container.ingestion.ingestAll();
        logger.info({ ...report, results: undefined }, 'ciclo de ingestao finalizado');
      } catch (error) {
        logger.error({ err: error }, 'ciclo de ingestao falhou');
      }
    },
    { name: 'ingestion', noOverlap: true, timezone: 'UTC' },
  );

  logger.info({ cron: env.INGEST_CRON }, 'agendador de ingestao ativo');
  return task;
}
