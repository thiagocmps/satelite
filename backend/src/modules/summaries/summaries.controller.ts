import type { Request, Response } from 'express';
import { valid } from '../../middleware/validate.middleware.js';
import type { SummariesService } from './summaries.service.js';

export function createSummariesController(summaries: SummariesService) {
  return {
    /** 200 com { data: null } significa "ainda nao gerado" (nao e erro). */
    get: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      res.json({ data: await summaries.get(id) });
    },

    generate: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const data = await summaries.generate(id);
      res.status(200).json({ data });
    },
  };
}
