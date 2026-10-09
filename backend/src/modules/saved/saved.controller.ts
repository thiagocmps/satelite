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

    suggest: async (req: Request, res: Response) => {
      const { articleId } = valid<{ articleId: string }>(req, 'body');
      res.json({ data: await saved.suggestGroup(articleId) });
    },
  };
}
