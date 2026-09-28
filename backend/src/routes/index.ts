import { Router } from 'express';
import type { Container } from '../container.js';
import { generalRateLimit, summaryRateLimit } from '../middleware/rateLimit.middleware.js';
import { createCategoriesController } from '../modules/categories/categories.controller.js';
import { createCategoriesRoutes } from '../modules/categories/categories.routes.js';
import { createIngestionController } from '../modules/ingestion/ingestion.controller.js';
import { createIngestionRoutes } from '../modules/ingestion/ingestion.routes.js';
import { createNewsController } from '../modules/news/news.controller.js';
import { createNewsRoutes } from '../modules/news/news.routes.js';
import { createSourcesController } from '../modules/sources/sources.controller.js';
import { createSourcesRoutes } from '../modules/sources/sources.routes.js';
import { createSummariesController } from '../modules/summaries/summaries.controller.js';

export function createApiRouter(container: Container): Router {
  const { env, pool } = container;
  const router = Router();

  // --- health ---------------------------------------------------------------
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'satelite-api',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  /** Readiness: so responde ok se o Postgres estiver acessivel. */
  router.get('/health/ready', async (_req, res) => {
    try {
      await pool.query('select 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // --- recursos -------------------------------------------------------------
  const newsController = createNewsController(container.news);
  const summariesController = createSummariesController(container.summaries);
  const categoriesController = createCategoriesController(container.categoriesRepository);
  const sourcesController = createSourcesController(
    container.sourcesRepository,
    container.ingestion,
    env.APP_NAME,
    container.categoriesRepository,
  );
  const ingestionController = createIngestionController(container.ingestion, container.runsRepository);

  router.use(generalRateLimit(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX));
  router.use('/news', createNewsRoutes(newsController, summariesController, summaryRateLimit(env.SUMMARY_RATE_LIMIT_WINDOW_MS, env.SUMMARY_RATE_LIMIT_MAX)));
  router.use('/categories', createCategoriesRoutes(categoriesController));
  router.use('/sources', createSourcesRoutes(sourcesController));
  router.use('/ingest', createIngestionRoutes(ingestionController));

  return router;
}
