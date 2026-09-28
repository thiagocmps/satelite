import type { Request, Response } from 'express';
import { NotFoundError } from '../../core/errors.js';
import { valid } from '../../middleware/validate.middleware.js';
import type { IngestionService } from '../ingestion/ingestion.service.js';
import { buildOpml } from './sources.opml.js';
import type { SourcesRepository } from './sources.repository.js';
import type { SourceInput, SourcePatch } from './sources.types.js';

const dateStamp = (): string => new Date().toISOString().slice(0, 10);

export function createSourcesController(sources: SourcesRepository, ingestion: IngestionService, appName: string) {
  return {
    list: async (_req: Request, res: Response) => {
      res.json({ data: await sources.list() });
    },

    get: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const source = await sources.findById(id);
      if (!source) throw new NotFoundError(`Fonte ${id} nao encontrada`);
      res.json({ data: source });
    },

    create: async (req: Request, res: Response) => {
      const body = valid<SourceInput>(req, 'body');
      res.status(201).json({ data: await sources.create(body) });
    },

    update: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const updated = await sources.update(id, valid<SourcePatch>(req, 'body'));
      if (!updated) throw new NotFoundError(`Fonte ${id} nao encontrada`);
      res.json({ data: updated });
    },

    remove: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      if (!(await sources.remove(id))) throw new NotFoundError(`Fonte ${id} nao encontrada`);
      res.status(204).end();
    },

    /**
     * Download de todas as fontes (ativas ou nao). OPML para importar em
     * leitores de RSS; JSON para backup fiel do que esta cadastrado.
     */
    exportSources: async (req: Request, res: Response) => {
      const { format } = valid<{ format: 'opml' | 'json' }>(req, 'query');
      const all = await sources.list();

      if (format === 'json') {
        res
          .status(200)
          .setHeader('content-type', 'application/json; charset=utf-8')
          .setHeader('content-disposition', `attachment; filename="satelite-sources-${dateStamp()}.json"`)
          .json({ data: all });
        return;
      }

      const xml = buildOpml(all, { appName });
      res
        .status(200)
        .setHeader('content-type', 'text/x-opml; charset=utf-8')
        .setHeader('content-disposition', `attachment; filename="satelite-sources-${dateStamp()}.opml"`)
        .send(xml);
    },

    ingest: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const source = await sources.findById(id);
      if (!source) throw new NotFoundError(`Fonte ${id} nao encontrada`);
      res.json({ data: await ingestion.ingestSource(source) });
    },
  };
}
