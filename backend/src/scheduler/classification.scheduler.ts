import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from '../config/logger.js';
import type { Container } from '../container.js';

/**
 * Classificacao periodica da fila `needs_ai`. Sem ela, novos artigos so saem da
 * fila no clique do botao "Classificar pendentes" (SourcesPage); com ela, a
 * fila drena sozinha. Fila vazia = ciclo nao faz nenhuma chamada de IA.
 *
 * Cadencia e on/off vem da CONFIGURACAO EM RUNTIME (tela /config-ia): o
 * server.ts repara este agendador a cada save, entao trocar o cron ali vale
 * na hora. Desligue pela tela (Agendador automatico) ou pelo .env
 * (ENABLE_CLASSIFY_SCHEDULER) — o que vier de override vence.
 */
export function startClassificationScheduler(container: Container, logger: Logger): ScheduledTask | null {
  const ai = container.settings.ai();

  if (!ai.classify.enabled) {
    logger.info('agendador de classificacao desabilitado (classificacao por IA desligada na config)');
    return null;
  }
  if (!ai.scheduler.classifyEnabled) {
    logger.info('agendador de classificacao desabilitado (agendador desligado na config)');
    return null;
  }
  if (!cron.validate(ai.scheduler.classifyCron)) {
    throw new Error(`CLASSIFY_CRON invalido: "${ai.scheduler.classifyCron}" (use expressao cron de 5 campos)`);
  }

  const task = cron.schedule(
    ai.scheduler.classifyCron,
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

  logger.info({ cron: ai.scheduler.classifyCron }, 'agendador de classificacao ativo');
  return task;
}
