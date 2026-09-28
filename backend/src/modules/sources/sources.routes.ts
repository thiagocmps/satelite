import { Router, text } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import type { createSourcesController } from './sources.controller.js';
import { createSchema, exportQuerySchema, idParamsSchema, updateSchema } from './sources.schemas.js';

export function createSourcesRoutes(controller: ReturnType<typeof createSourcesController>) {
  const router = Router();

  router.get('/', controller.list);
  // antes das rotas com :id — e literal, nao um id de fonte
  router.get('/export', validate({ query: exportQuerySchema }), controller.exportSources);
  // corpo cru (OPML/JSON em texto): express.text montado so nesta rota. Para o
  // JSON ja parseado pelo express.json global, o parser do import lida com objeto.
  router.post(
    '/import',
    text({ limit: '2mb', type: () => true }),
    controller.importSources,
  );
  router.post('/', validate({ body: createSchema }), controller.create);
  router.patch('/:id', validate({ params: idParamsSchema, body: updateSchema }), controller.update);
  router.delete('/:id', validate({ params: idParamsSchema }), controller.remove);
  router.post('/:id/ingest', validate({ params: idParamsSchema }), controller.ingest);

  return router;
}
