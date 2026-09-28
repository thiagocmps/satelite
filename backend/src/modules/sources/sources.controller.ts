import type { Request, Response } from 'express';
import { NotFoundError } from '../../core/errors.js';
import { valid } from '../../middleware/validate.middleware.js';
import type { IngestionService } from '../ingestion/ingestion.service.js';
import type { SourcesRepository } from './sources.repository.js';
import type { SourceInput, SourcePatch } from './sources.types.js';

export function createSourcesController(sources: SourcesRepository, ingestion: IngestionService) {
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

    ingest: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const source = await sources.findById(id);
      if (!source) throw new NotFoundError(`Fonte ${id} nao encontrada`);
      res.json({ data: await ingestion.ingestSource(source) });
    },
  };
}
