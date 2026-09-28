import type { Request, Response } from 'express';
import { valid } from '../../middleware/validate.middleware.js';
import type { IngestionRunsRepository } from './ingestion.repository.js';
import type { IngestionService } from './ingestion.service.js';

export function createIngestionController(ingestion: IngestionService, runs: IngestionRunsRepository) {
  return {
    run: async (_req: Request, res: Response) => {
      res.json({ data: await ingestion.ingestAll() });
    },

    listRuns: async (req: Request, res: Response) => {
      const { limit, source } = valid<{ limit: number; source?: string }>(req, 'query');
      res.json({ data: await runs.list(limit, source) });
    },
  };
}
