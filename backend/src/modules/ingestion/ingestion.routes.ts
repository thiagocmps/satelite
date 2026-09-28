import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import type { createIngestionController } from './ingestion.controller.js';
import { listRunsQuerySchema } from './ingestion.schemas.js';

export function createIngestionRoutes(controller: ReturnType<typeof createIngestionController>) {
  const router = Router();

  router.post('/run', controller.run);
  router.get('/runs', validate({ query: listRunsQuerySchema }), controller.listRuns);

  return router;
}
