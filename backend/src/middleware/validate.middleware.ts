import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { Request } from 'express';
import { ValidationError } from '../core/errors.js';

export type SchemaKey = 'params' | 'query' | 'body';

export type Schemas = Partial<Record<SchemaKey, z.ZodType>>;

/**
 * Valida e normaliza params/query/body. O resultado fica em `req.valid[key]`
 * (nao em req.query, que e getter no Express 5 e nao pode ser reatribuido).
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        return next(
          new ValidationError('Dados invalidos', {
            field: key,
            issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          }),
        );
      }
      req.valid = { ...req.valid, [key]: result.data };
    }
    next();
  };
}

/** Le dado validado com tipagem (o middleware garante que ele existe). */
export const valid = <T>(req: Request, key: SchemaKey): T => (req.valid?.[key] ?? {}) as T;
