import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const idParamsSchema = z.object({ id: z.uuid() });

export const listQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    category: z.uuid().optional(),
    source: z.uuid().optional(),
    from: z.string().regex(ISO_DATE, 'use o formato YYYY-MM-DD').optional(),
    to: z.string().regex(ISO_DATE, 'use o formato YYYY-MM-DD').optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
    sort: z.enum(['recent', 'relevance']).default('recent'),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '"from" deve ser anterior ou igual a "to"',
    path: ['from'],
  });

export type ListQueryInput = z.infer<typeof listQuerySchema>;
