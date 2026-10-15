import type { Request, Response } from 'express';
import { valid } from '../../middleware/validate.middleware.js';
import type { SettingsService } from './settings.service.js';
import type { AiSettingsPatch } from './settings.types.js';

export function createSettingsController(settings: SettingsService) {
  return {
    get: async (_req: Request, res: Response) => {
      res.json({ data: settings.view() });
    },

    /** Salva + aplica em runtime (provider/cron trocam na hora). Devolve a visao nova. */
    update: async (req: Request, res: Response) => {
      res.json({ data: await settings.update(valid<AiSettingsPatch>(req, 'body')) });
    },
  };
}
