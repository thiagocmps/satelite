import { describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { loadEnv } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';
import { ExternalServiceError, NotFoundError } from '../../core/errors.js';
import type { AiProvider } from '../../integrations/ai/ai.provider.js';
import type { Article } from '../news/news.types.js';
import { aiDefaults } from '../settings/settings.defaults.js';
import type { AiSettingsSource } from '../settings/settings.types.js';
import type { NewsGroup, SavedRepository } from './saved.repository.js';
import { SavedService, type SavedDeps } from './saved.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

/** Config de IA falsa: defaults do .env (piso de confianca = 0.6, como em producao). */
const settingsSource = (): AiSettingsSource => ({
  ai: () =>
    aiDefaults(
      loadEnv({
        DATABASE_URL: 'postgres://user:pass@localhost:5432/satelite',
        AI_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'sk-or-teste',
      }),
    ),
});

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
  note: null,
};

function setup(
  overrides: Partial<{
    suggestText: string;
    groups: NewsGroup[];
    articlesByGroup: Record<string, Article[]>;
  }> = {},
) {
  const saved: Array<[string, string]> = [];
  const created: Array<{ name: string }> = [];
  const notes = new Map<string, string | null>();
  const repository = {
    findGroupById: async (id: string) => (id === 'g-1' ? group : null),
    updateGroup: async () => null,
    createGroup: async (input: { name: string }) => {
      created.push(input);
      return { ...group, name: input.name };
    },
    save: async (groupId: string, articleId: string) => {
      saved.push([groupId, articleId]);
    },
    listGroups: async () => overrides.groups ?? [group],
    listGroupArticlesForExport: async (groupId: string) => overrides.articlesByGroup?.[groupId] ?? [],
    setNote: async (articleId: string, note: string | null) => {
      notes.set(articleId, note);
    },
    setNotes: async (entries: Array<{ articleId: string; note: string }>) => {
      for (const entry of entries) notes.set(entry.articleId, entry.note);
      return entries.length;
    },
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

  const service = new SavedService({ repository, news, provider, settings: settingsSource(), logger } satisfies SavedDeps);

  return { service, saved, created, notes };
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

  it('normaliza espacos internos do nome ao criar', async () => {
    const { service, created } = setup();
    await service.createGroup({ name: '  Eleicoes   2026  ' });
    expect(created[0]?.name).toBe('Eleicoes 2026');
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

  describe('anotação pessoal', () => {
    it('grava a nota da noticia', async () => {
      const { service, notes } = setup();
      await service.setNote('a-1', 'conferir a resolução');
      expect(notes.get('a-1')).toBe('conferir a resolução');
    });

    it('espaços nas pontas viram nota limpa; só espaços apagam (null)', async () => {
      const { service, notes } = setup();
      await service.setNote('a-1', '  anotação  ');
      expect(notes.get('a-1')).toBe('anotação');

      await service.setNote('a-1', '   \n  ');
      expect(notes.get('a-1')).toBeNull();
    });

    it('preserva linhas internas (nota multilinha)', async () => {
      const { service, notes } = setup();
      await service.setNote('a-1', 'linha um\nlinha dois');
      expect(notes.get('a-1')).toBe('linha um\nlinha dois');
    });

    it('404 para noticia inexistente', async () => {
      const { service } = setup();
      await expect(service.setNote('a-x', 'nota')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('export de todas as coleções (ZIP)', () => {
    it('gera um .md por coleção em satelite-colecoes/, fiel ao conteúdo', async () => {
      const vazia: NewsGroup = {
        id: 'g-2',
        name: 'Mobilidade Portugal',
        color: null,
        savedCount: 0,
        createdAt: new Date(),
      };
      const { service } = setup({
        groups: [group, vazia],
        articlesByGroup: { 'g-1': [{ ...article, note: 'acompanhar' }] },
      });

      const file = await service.exportAllCollectionsZip();

      expect(file.filename).toMatch(/^satelite-colecoes-\d{4}-\d{2}-\d{2}\.zip$/);

      const zip = new AdmZip(file.buffer);
      expect(zip.getEntries().map((entry) => entry.entryName)).toEqual([
        'satelite-colecoes/eleicoes-2026.md',
        'satelite-colecoes/mobilidade-portugal.md',
      ]);

      const md = zip.readAsText('satelite-colecoes/eleicoes-2026.md');
      expect(md).toContain('## Eleicoes 2026');
      expect(md).toContain('### Lula e Bolsonaro disputam o segundo turno');
      expect(md).toContain('[exemplo.com ↗](https://exemplo.com/1)');
      expect(md).toContain('acompanhar');

      // coleção vazia: só o título — o arquivo é fiel ao que existe
      expect(zip.readAsText('satelite-colecoes/mobilidade-portugal.md')).toBe('## Mobilidade Portugal\n');
    });

    it('nome repetido ganha sufixo -2, -3 (nenhum arquivo sobrescreve o outro)', async () => {
      const clone: NewsGroup = { ...group, id: 'g-9' };
      const { service } = setup({ groups: [group, clone, { ...clone, id: 'g-10' }] });

      const file = await service.exportAllCollectionsZip();
      const names = new AdmZip(file.buffer).getEntries().map((entry) => entry.entryName);

      // ordem do ZIP nao importa: o que importa e nenhum arquivo sobrescrever o outro
      expect(new Set(names)).toEqual(
        new Set([
          'satelite-colecoes/eleicoes-2026.md',
          'satelite-colecoes/eleicoes-2026-2.md',
          'satelite-colecoes/eleicoes-2026-3.md',
        ]),
      );
      expect(names).toHaveLength(3);
    });
  });
});
