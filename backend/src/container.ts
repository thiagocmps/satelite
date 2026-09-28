import type { Logger } from './config/logger.js';
import { createAiProvider } from './integrations/ai/ai.registry.js';
import { createFeedLoader } from './integrations/rss/rss.adapter.js';
import { PgCategoriesRepository } from './modules/categories/categories.repository.js';
import { IngestionService } from './modules/ingestion/ingestion.service.js';
import { PgIngestionRunsRepository } from './modules/ingestion/ingestion.repository.js';
import { PgNewsRepository } from './modules/news/news.repository.js';
import { NewsService } from './modules/news/news.service.js';
import { PgSourcesRepository } from './modules/sources/sources.repository.js';
import { PgSummariesRepository } from './modules/summaries/summaries.repository.js';
import { SummariesService } from './modules/summaries/summaries.service.js';
import type { Env } from './config/env.js';
import type { Pool } from 'pg';

/**
 * Composicao unica: resolve o que e Postgres, o que e integracao externa e
 * liga tudo. Services recebem suas dependencias por construtor, o que permite
 * testar com doubles sem subir banco nem IA.
 */
export function createContainer(env: Env, logger: Logger, pool: Pool) {
  const newsRepository = new PgNewsRepository(pool);
  const categoriesRepository = new PgCategoriesRepository(pool);
  const sourcesRepository = new PgSourcesRepository(pool);
  const summariesRepository = new PgSummariesRepository(pool);
  const runsRepository = new PgIngestionRunsRepository(pool);
  const aiProvider = createAiProvider(env);

  const ingestion = new IngestionService({
    sources: sourcesRepository,
    news: newsRepository,
    runs: runsRepository,
    loadFeed: createFeedLoader({ timeoutMs: env.INGEST_TIMEOUT_MS, maxBytes: env.FEED_MAX_BYTES }),
    listRules: () => categoriesRepository.listRules(),
    logger,
    concurrency: env.INGEST_CONCURRENCY,
  });

  return {
    env,
    pool,
    newsRepository,
    categoriesRepository,
    sourcesRepository,
    summariesRepository,
    runsRepository,
    aiProvider,
    news: new NewsService(newsRepository),
    summaries: new SummariesService({
      news: newsRepository,
      summaries: summariesRepository,
      provider: aiProvider,
      promptVersion: env.AI_PROMPT_VERSION,
      language: env.AI_LANGUAGE,
      logger,
    }),
    ingestion,
  };
}

export type Container = ReturnType<typeof createContainer>;
