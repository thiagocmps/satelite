import type { Request, Response } from 'express';
import type { ClassificationService } from './classification.service.js';

export function createClassificationController(classification: ClassificationService) {
  return {
    run: async (_req: Request, res: Response) => {
      res.json({ data: await classification.runOnce() });
    },

    status: async (_req: Request, res: Response) => {
      res.json({ data: { pending: await classification.countPending() } });
    },
  };
}