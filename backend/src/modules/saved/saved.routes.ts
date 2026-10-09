import { Router, type RequestHandler } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import {
  articleIdBodySchema,
  createGroupSchema,
  groupIdParamsSchema,
  savedListQuerySchema,
  savedParamsSchema,
  updateGroupSchema,
} from './saved.schemas.js';
import type { createSavedController } from './saved.controller.js';

/**
 * Grupos de noticias salvas. `suggestLimiter` e o mesmo limite das chamadas de
 * IA: a sugestao de grupo custa modelo.
 */
export function createSavedRoutes(
  controller: ReturnType<typeof createSavedController>,
  suggestLimiter: RequestHandler,
) {
  const router = Router();

  router.get('/groups', controller.listGroups);
  router.post('/groups', validate({ body: createGroupSchema }), controller.createGroup);
  router.post('/groups/suggest', suggestLimiter, validate({ body: articleIdBodySchema }), controller.suggest);
  router.patch('/groups/:id', validate({ params: groupIdParamsSchema, body: updateGroupSchema }), controller.updateGroup);
  router.delete('/groups/:id', validate({ params: groupIdParamsSchema }), controller.removeGroup);
  router.get('/groups/:id/articles', validate({ params: groupIdParamsSchema, query: savedListQuerySchema }), controller.listGroupArticles);
  router.put('/groups/:id/articles/:articleId', validate({ params: savedParamsSchema }), controller.save);
  router.delete('/groups/:id/articles/:articleId', validate({ params: savedParamsSchema }), controller.unsave);

  router.get('/saved', validate({ query: savedListQuerySchema }), controller.listSaved);
  router.get('/saved/ids', controller.listSavedIds);

  return router;
}
