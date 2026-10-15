import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { aiPatchShape } from './settings.schema.js';
import type { createSettingsController } from './settings.controller.js';

export function createSettingsRoutes(controller: ReturnType<typeof createSettingsController>) {
  const router = Router();

  router.get('/ai', controller.get);
  router.patch('/ai', validate({ body: aiPatchShape }), controller.update);

  return router;
}
