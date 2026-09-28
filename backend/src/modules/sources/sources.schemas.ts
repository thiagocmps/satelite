import { z } from 'zod';

const slug = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use apenas minusculas, numeros e hifens');

const feedUrl = z.url('informe uma URL valida de feed RSS/Atom');

export const idParamsSchema = z.object({ id: z.uuid() });

/** Formato do download de fontes. OPML e o padrao de listas RSS; JSON e o backup cru. */
export const exportQuerySchema = z.object({ format: z.enum(['opml', 'json']).default('opml') });

export const createSchema = z.object({
  slug,
  name: z.string().trim().min(2).max(80),
  feedUrl,
  siteUrl: z.url('informe uma URL valida').nullish(),
  defaultCategoryId: z.uuid().nullish(),
  enabled: z.boolean().default(true),
});

export const updateSchema = createSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'informe ao menos um campo' });
