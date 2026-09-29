import { Router } from 'express';
import type { createClassificationController } from './classification.controller.js';

/** Endpoints da fila de classificacao por IA, montados sob /api/v1/ingest. */
export function createClassificationRoutes(controller: ReturnType<typeof createClassificationController>) {
  const router = Router();

  router.post('/classify', controller.run);
  router.get('/classify/status', controller.status);

  return router;
}