import type { Request, Response } from 'express';
import { NotFoundError } from '../../core/errors.js';
import { valid } from '../../middleware/validate.middleware.js';
import type { CategoriesRepository, CategoryInput, CategoryPatch } from './categories.repository.js';

export function createCategoriesController(categories: CategoriesRepository) {
  return {
    list: async (_req: Request, res: Response) => {
      res.json({ data: await categories.list() });
    },

    create: async (req: Request, res: Response) => {
      const body = valid<CategoryInput>(req, 'body');
      res.status(201).json({ data: await categories.create(body) });
    },

    update: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const updated = await categories.update(id, valid<CategoryPatch>(req, 'body'));
      if (!updated) throw new NotFoundError(`Categoria ${id} nao encontrada`);
      res.json({ data: updated });
    },

    remove: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      if (!(await categories.remove(id))) throw new NotFoundError(`Categoria ${id} nao encontrada`);
      res.status(204).end();
    },

    listRules: async (req: Request, res: Response) => {
      res.json({ data: await categories.listRules() });
    },

    addRule: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const { keyword } = valid<{ keyword: string }>(req, 'body');
      res.status(201).json({ data: await categories.addRule(id, keyword) });
    },

    removeRule: async (req: Request, res: Response) => {
      const { ruleId } = valid<{ ruleId: string }>(req, 'params');
      if (!(await categories.removeRule(ruleId))) throw new NotFoundError(`Regra ${ruleId} nao encontrada`);
      res.status(204).end();
    },
  };
}
