import type { Request, Response } from 'express';
import { valid } from '../../middleware/validate.middleware.js';
import type { ListQueryInput } from './news.schemas.js';
import type { NewsService } from './news.service.js';
import type { NewsListQuery } from './news.types.js';

/** Converte a query da API (ids e datas em string) no formato do repositorio. */
export const toListQuery = (input: ListQueryInput): NewsListQuery => ({
  q: input.q,
  categoryId: input.category,
  sourceId: input.source,
  from: input.from,
  to: input.to ? `${input.to}T23:59:59.999Z` : undefined,
  page: input.page,
  limit: input.limit,
  sort: input.sort,
});

export function createNewsController(news: NewsService) {
  return {
    list: async (req: Request, res: Response) => {
      const query = toListQuery(valid<ListQueryInput>(req, 'query'));
      res.json(await news.list(query));
    },

    get: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      res.json({ data: await news.get(id) });
    },
  };
}
