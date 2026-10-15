import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from '../config/logger.js';
import type { Container } from '../container.js';

/**
 * Classificacao periodica da fila `needs_ai`. Sem ela, novos artigos so saem da
 * fila no clique do botao "Classificar pendentes" (SourcesPage); com ela, a
 * fila drena sozinha. Fila vazia = ciclo nao faz nenhuma chamada de IA.
 *
 * Desligue com ENABLE_CLASSIFY_SCHEDULER=false (ex.: quota apertada e voce
 * prefere classificar sob demanda).
 */
export function startClassificationScheduler(container: Container, logger: Logger): ScheduledTask | null {
  const { env } = container;

  if (!env.AI_CLASSIFY_ENABLED) {
    logger.info('agendador de classificacao desabilitado (AI_CLASSIFY_ENABLED=false)');
    return null;
  }
  if (!env.ENABLE_CLASSIFY_SCHEDULER) {
    logger.info('agendador de classificacao desabilitado (ENABLE_CLASSIFY_SCHEDULER=false)');
    return null;
  }
  if (!cron.validate(env.CLASSIFY_CRON)) {
    throw new Error(`CLASSIFY_CRON invalido: "${env.CLASSIFY_CRON}" (use expressao cron de 5 campos)`);
  }

  const task = cron.schedule(
    env.CLASSIFY_CRON,
    async () => {
      if (container.classification.isRunning) {
        logger.warn('classificacao anterior ainda em andamento; ciclo ignorado');
        return;
      }
      try {
        const report = await container.classification.runOnce();
        // fila vazia devolve report zerado; log so quando houve trabalho
        if (report.processed > 0) {
          logger.info({ ...report }, 'ciclo de classificacao finalizado');
        }
      } catch (error) {
        logger.error({ err: error }, 'ciclo de classificacao falhou');
      }
    },
    { name: 'classification', noOverlap: true, timezone: 'UTC' },
  );

  logger.info({ cron: env.CLASSIFY_CRON }, 'agendador de classificacao ativo');
  return task;
}
