import { z } from 'zod';

const slug = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use apenas minusculas, numeros e hifens');

const feedUrl = z.url('informe uma URL valida de feed RSS/Atom');

export const idParamsSchema = z.object({ id: z.uuid() });

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
