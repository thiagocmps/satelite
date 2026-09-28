import { z } from 'zod';

const slug = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use apenas minusculas, numeros e hifens');

const name = z.string().trim().min(2).max(80);
const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'use o formato #rrggbb').nullish();

export const idParamsSchema = z.object({ id: z.uuid() });
export const slugParamsSchema = z.object({ slug });

export const createSchema = z.object({ slug, name, description: z.string().trim().max(300).nullish(), color: hexColor });
export const updateSchema = createSchema.partial().refine((patch) => Object.keys(patch).length > 0, {
  message: 'informe ao menos um campo',
});

export const ruleSchema = z.object({ keyword: z.string().trim().min(2).max(60) });
export const ruleIdParamsSchema = z.object({ id: z.uuid(), ruleId: z.uuid() });
