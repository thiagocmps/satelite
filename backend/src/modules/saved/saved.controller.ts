import type { Request, Response } from 'express';
import { valid } from '../../middleware/validate.middleware.js';
import type { GroupInput, GroupPatch } from './saved.repository.js';
import type { SavedService } from './saved.service.js';
import type { SavedListQueryInput } from './saved.schemas.js';

export function createSavedController(saved: SavedService) {
  return {
    listGroups: async (_req: Request, res: Response) => {
      res.json({ data: await saved.listGroups() });
    },

    createGroup: async (req: Request, res: Response) => {
      res.status(201).json({ data: await saved.createGroup(valid<GroupInput>(req, 'body')) });
    },

    updateGroup: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      res.json({ data: await saved.updateGroup(id, valid<GroupPatch>(req, 'body')) });
    },

    removeGroup: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      await saved.removeGroup(id);
      res.status(204).end();
    },

    listGroupArticles: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      res.json(await saved.listGroupArticles(id, valid<SavedListQueryInput>(req, 'query')));
    },

    save: async (req: Request, res: Response) => {
      const { id, articleId } = valid<{ id: string; articleId: string }>(req, 'params');
      await saved.save(id, articleId);
      res.status(204).end();
    },

    unsave: async (req: Request, res: Response) => {
      const { id, articleId } = valid<{ id: string; articleId: string }>(req, 'params');
      await saved.unsave(id, articleId);
      res.status(204).end();
    },

    listSaved: async (req: Request, res: Response) => {
      res.json(await saved.listSaved(valid<SavedListQueryInput>(req, 'query')));
    },

    listSavedIds: async (_req: Request, res: Response) => {
      res.json({ data: await saved.listSavedIds() });
    },

    /** Anotação pessoal da notícia. Corpo `{ note }`; string vazia limpa. */
    setNote: async (req: Request, res: Response) => {
      const { articleId } = valid<{ articleId: string }>(req, 'params');
      const { note } = valid<{ note: string }>(req, 'body');
      await saved.setNote(articleId, note);
      res.json({ data: { articleId, note } });
    },

    /** Download da coleção em Markdown (leitura) ou JSON (backup). */
    exportGroup: async (req: Request, res: Response) => {
      const { id } = valid<{ id: string }>(req, 'params');
      const { format } = valid<{ format: 'markdown' | 'json' }>(req, 'query');
      const file = await saved.exportGroup(id, format);
      res
        .status(200)
        .setHeader('content-type', file.contentType)
        .setHeader('content-disposition', `attachment; filename="${file.filename}"`)
        .send(file.body);
    },

    /** Download de TODAS as coleções num ZIP, um Markdown por coleção. */
    exportAll: async (_req: Request, res: Response) => {
      const file = await saved.exportAllCollectionsZip();
      res
        .status(200)
        .setHeader('content-type', 'application/zip')
        .setHeader('content-disposition', `attachment; filename="${file.filename}"`)
        .send(file.buffer);
    },

    suggest: async (req: Request, res: Response) => {
      const { articleId } = valid<{ articleId: string }>(req, 'body');
      res.json({ data: await saved.suggestGroup(articleId) });
    },

    /**
     * Corpo cru: o arquivo (Markdown ou JSON, detectado pelo conteudo), lido
     * pelo text() da rota (mesmo arranjo do import de fontes). Se o
     * express.json() global ja parseou o corpo (content-type application/json),
     * re-serializa: senao um import de JSON via curl com esse header cairia
     * como vazio. Erros de formato viram 400.
     */
    importGroup: async (req: Request, res: Response) => {
      const body = req.body;
      const raw =
        typeof body === 'string' ? body : body && typeof body === 'object' ? JSON.stringify(body) : '';
      res.status(201).json({ data: await saved.importGroup(raw) });
    },
  };
}
