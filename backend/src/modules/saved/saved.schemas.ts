import { z } from 'zod';

const groupName = z.string().trim().min(2).max(80);
const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'use o formato #rrggbb').nullish();

export const groupIdParamsSchema = z.object({ id: z.uuid() });
export const savedParamsSchema = z.object({ id: z.uuid(), articleId: z.uuid() });
export const articleIdBodySchema = z.object({ articleId: z.uuid() });

export const createGroupSchema = z.object({ name: groupName, color: hexColor });
export const updateGroupSchema = z
  .object({ name: groupName.optional(), color: hexColor })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'informe ao menos um campo' });

export const savedListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type SavedListQueryInput = z.infer<typeof savedListQuerySchema>;
