import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../config/logger.js';
import { ExternalServiceError, NotFoundError } from '../../core/errors.js';
import type { AiProvider } from '../../integrations/ai/ai.provider.js';
import type { Article } from '../news/news.types.js';
import type { NewsGroup, SavedRepository } from './saved.repository.js';
import { SavedService, type SavedDeps } from './saved.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const group: NewsGroup = { id: 'g-1', name: 'Eleicoes 2026', color: null, savedCount: 0, createdAt: new Date() };

const article: Article = {
  id: 'a-1',
  title: 'Lula e Bolsonaro disputam o segundo turno',
  description: null,
  content: 'Texto da noticia',
  imageUrl: null,
  author: null,
  url: 'https://exemplo.com/1',
  publishedAt: '2026-09-28T10:00:00.000Z',
  ingestedAt: '2026-09-28T10:05:00.000Z',
  source: { id: 's-1', slug: 'g1', name: 'G1', siteUrl: null },
  category: null,
  categoryMethod: null,
  categoryConfidence: null,
  summary: null,
};

function setup(overrides: Partial<{ suggestText: string; groups: NewsGroup[] }> = {}) {
  const saved: Array<[string, string]> = [];
  const repository = {
    findGroupById: async (id: string) => (id === 'g-1' ? group : null),
    updateGroup: async () => null,
    save: async (groupId: string, articleId: string) => {
      saved.push([groupId, articleId]);
    },
    listGroups: async () => overrides.groups ?? [group],
  } as unknown as SavedRepository;

  const news = { findById: async (id: string) => (id === 'a-1' ? article : null) };

  const provider = {
    name: 'fake',
    model: 'fake-model',
    summarize: () => Promise.reject(new Error('nao usado')),
    classify: () => Promise.reject(new Error('nao usado')),
    suggestGroup: async () => ({
      text: overrides.suggestText ?? '{"groupId":"g-1","newGroupName":null,"confidence":0.9}',
      provider: 'fake',
      model: 'fake-model',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 1,
    }),
  } as unknown as AiProvider;

  const service = new SavedService({ repository, news, provider, language: 'pt-BR', maxContentChars: 500, minConfidence: 0.6, logger } satisfies SavedDeps);

  return { service, saved };
}

describe('SavedService', () => {
  it('salva quando grupo e noticia existem', async () => {
    const { service, saved } = setup();
    await service.save('g-1', 'a-1');
    expect(saved).toEqual([['g-1', 'a-1']]);
  });

  it('404 quando o grupo nao existe', async () => {
    const { service } = setup();
    await expect(service.save('g-x', 'a-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404 quando a noticia nao existe', async () => {
    const { service } = setup();
    await expect(service.save('g-1', 'a-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404 ao atualizar grupo inexistente', async () => {
    const { service } = setup();
    await expect(service.updateGroup('g-x', { name: 'Novo' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sugere um grupo existente', async () => {
    const { service } = setup();
    await expect(service.suggestGroup('a-1')).resolves.toEqual({ groupId: 'g-1', newGroupName: null, confidence: 0.9 });
  });

  it('404 ao sugerir para noticia inexistente', async () => {
    const { service } = setup();
    await expect(service.suggestGroup('a-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('502 quando a IA responde algo ilegivel', async () => {
    const { service } = setup({ suggestText: 'nao e json' });
    await expect(service.suggestGroup('a-1')).rejects.toMatchObject({ code: 'AI_BAD_RESPONSE' });
    await expect(service.suggestGroup('a-1')).rejects.toBeInstanceOf(ExternalServiceError);
  });
});
