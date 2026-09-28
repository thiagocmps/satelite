import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import type { createCategoriesController } from './categories.controller.js';
import { createSchema, idParamsSchema, ruleIdParamsSchema, ruleSchema, updateSchema } from './categories.schemas.js';

export function createCategoriesRoutes(controller: ReturnType<typeof createCategoriesController>) {
  const router = Router();

  router.get('/', controller.list);
  router.get('/rules', controller.listRules);
  router.post('/', validate({ body: createSchema }), controller.create);
  router.patch('/:id', validate({ params: idParamsSchema, body: updateSchema }), controller.update);
  router.delete('/:id', validate({ params: idParamsSchema }), controller.remove);
  router.post('/:id/rules', validate({ params: idParamsSchema, body: ruleSchema }), controller.addRule);
  router.delete('/:id/rules/:ruleId', validate({ params: ruleIdParamsSchema }), controller.removeRule);

  return router;
}
