import { Router, type RequestHandler } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { idParamsSchema, listQuerySchema } from './news.schemas.js';
import type { createNewsController } from './news.controller.js';
import type { createSummariesController } from '../summaries/summaries.controller.js';

export function createNewsRoutes(
  news: ReturnType<typeof createNewsController>,
  summaries: ReturnType<typeof createSummariesController>,
  summaryLimiter: RequestHandler,
) {
  const router = Router();

  router.get('/', validate({ query: listQuerySchema }), news.list);
  router.get('/:id', validate({ params: idParamsSchema }), news.get);

  // O resumo vive sob /news/:id/summary; as rotas ficam aqui para que o
  // controlador de resumos cuide apenas da logica de IA.
  router.get('/:id/summary', validate({ params: idParamsSchema }), summaries.get);
  router.post('/:id/summary', summaryLimiter, validate({ params: idParamsSchema }), summaries.generate);

  return router;
}
