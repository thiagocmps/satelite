import { z } from 'zod';

export const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  source: z.uuid().optional(),
});
