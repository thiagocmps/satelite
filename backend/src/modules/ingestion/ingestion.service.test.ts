import { describe, expect, it, vi } from 'vitest';
import { ConflictError, ExternalServiceError } from '../../core/errors.js';
import type { Logger } from '../../config/logger.js';
import type { FeedLoader, RawItem } from '../../integrations/rss/rss.types.js';
import { IngestionService, type IngestionDeps } from './ingestion.service.js';
import type { SourceRecord } from '../sources/sources.types.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const g1: SourceRecord = {
  id: 's-g1',
  slug: 'g1',
  name: 'G1',
  feedUrl: 'https://g1.globo.com/rss/g1/',
  siteUrl: 'https://g1.globo.com',
  defaultCategoryId: null,
  enabled: true,
  etag: null,
  lastModified: null,
  lastFetchedAt: null,
  lastStatus: null,
  lastError: null,
  category: null,
  createdAt: new Date(),
};

const bbc: SourceRecord = { ...g1, id: 's-bbc', slug: 'bbc', name: 'BBC', feedUrl: 'https://feeds.bbci.co.uk/news/rss.xml' };

type FakeState = { inserted: string[]; finished: Array<Record<string, unknown>>; marked: Array<Record<string, unknown>> };

function setup(overrides: Partial<IngestionDeps> = {}) {
  const state: FakeState = { inserted: [], finished: [], marked: [] };
  const existing = new Set<string>();

  const deps: IngestionDeps = {
    sources: {
      list: async () => [g1, bbc],
      listEnabled: async () => [g1, bbc],
      findById: async () => g1,
      findBySlug: async () => null,
      create: async () => g1,
      update: async () => g1,
      remove: async () => true,
      markFetched: async (id, patch) => {
        state.marked.push({ id, ...patch });
      },
    },
    news: {
      list: async () => ({ data: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0, hasNext: false, hasPrev: false } }),
      findById: async () => null,
      insertMany: async (articles) => {
        let inserted = 0;
        for (const article of articles) {
          if (existing.has(article.fingerprint)) continue;
          existing.add(article.fingerprint);
          state.inserted.push(article.title);
          inserted += 1;
        }
        return { inserted, duplicates: articles.length - inserted };
      },
    },
    runs: {
      start: async () => `run-${state.finished.length}`,
      finish: async (_id, result) => {
        state.finished.push(result as Record<string, unknown>);
      },
      list: async () => [],
    },
    loadFeed: async () => ({ notModified: false, status: 200, etag: 'W/"1"', lastModified: null, items: [] }),
    listRules: async () => [],
    logger,
    concurrency: 2,
    aiClassifyEnabled: true,
    minClassifyTextChars: 120,
    ...overrides,
  };

  return { service: new IngestionService(deps), state, existing };
}

const item = (title: string, extra: Partial<RawItem> = {}): RawItem => ({
  title,
  link: `https://exemplo.com/${encodeURIComponent(title)}`,
  isoDate: '2026-09-28T10:00:00Z',
  contentSnippet: 'Resumo',
  ...extra,
});

describe('IngestionService.ingestSource', () => {
  it('insere as noticias normalizadas e fecha a execucao', async () => {
    const { service, state } = setup({
      loadFeed: async () => ({ notModified: false, status: 200, etag: 'W/"1"', lastModified: null, items: [item('Noticia A'), item('Noticia B')] }),
    });

    const result = await service.ingestSource(g1);

    expect(result.status).toBe('ok');
    expect(result).toMatchObject({ fetched: 2, inserted: 2, duplicates: 0 });
    expect(state.inserted).toEqual(['Noticia A', 'Noticia B']);
    expect(state.finished[0]).toMatchObject({ status: 'ok', inserted: 2, httpStatus: 200 });
  });

  it('conta duplicatas vindas do mesmo feed', async () => {
    const { service, state } = setup({
      loadFeed: async () => ({ notModified: false, status: 200, etag: null, lastModified: null, items: [item('Repetida'), item('Repetida')] }),
    });

    const result = await service.ingestSource(g1);

    expect(result).toMatchObject({ inserted: 1, duplicates: 1 });
    expect(state.inserted).toHaveLength(1);
  });

  it('pula items invalidos sem falhar a fonte', async () => {
    const { service, state } = setup({
      loadFeed: async () => ({
        notModified: false,
        status: 200,
        etag: null,
        lastModified: null,
        items: [item('Boa'), { title: '', link: 'https://a.com' }, { title: 'Sem link' }],
      }),
    });

    const result = await service.ingestSource(g1);

    expect(result).toMatchObject({ fetched: 3, inserted: 1 });
    expect(state.inserted).toEqual(['Boa']);
  });

  it('respeita 304 e nao tenta inserir', async () => {
    const { service, state } = setup({
      loadFeed: async () => ({ notModified: true, etag: 'W/"1"', lastModified: null }),
    });

    const result = await service.ingestSource(g1);

    expect(result).toMatchObject({ status: 'not_modified', inserted: 0 });
    expect(state.inserted).toHaveLength(0);
    expect(state.finished[0]).toMatchObject({ status: 'skipped', notModified: true, httpStatus: 304 });
  });

  it('registra o erro da fonte e propaga', async () => {
    const { service, state } = setup({
      loadFeed: async () => {
        throw new ExternalServiceError('FEED_HTTP_ERROR', 'Feed respondeu HTTP 500');
      },
    });

    await expect(service.ingestSource(g1)).rejects.toThrow('HTTP 500');
    expect(state.finished[0]).toMatchObject({ status: 'error' });
    expect(state.marked[0]).toMatchObject({ status: 'error' });
  });

  it('categoria por palavra-chave tem precedencia sobre a padrao da fonte', async () => {
    const withCategory = { ...g1, defaultCategoryId: 'cat-geral' };
    const captured: Array<{ title: string; categoryId: string | null }> = [];

    const { service } = setup({
      listRules: async () => [{ categoryId: 'cat-tec', keyword: 'inteligencia artificial' }],
      loadFeed: async () => ({
        notModified: false,
        status: 200,
        etag: null,
        lastModified: null,
        items: [item('Inteligencia artificial avanca'), item('Outro tema')],
      }),
      news: {
        list: async () => ({ data: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0, hasNext: false, hasPrev: false } }),
        findById: async () => null,
        insertMany: async (articles) => {
          captured.push(...articles.map((a) => ({ title: a.title, categoryId: a.categoryId })));
          return { inserted: articles.length, duplicates: 0 };
        },
      },
    });

    await service.ingestSource(withCategory);

    expect(captured).toEqual([
      { title: 'Inteligencia artificial avanca', categoryId: 'cat-tec' },
      { title: 'Outro tema', categoryId: 'cat-geral' },
    ]);
  });

  it('keyword no corpo da noticia NAO decide categoria (escopo titulo+descricao)', async () => {
    const captured: Array<{ title: string; categoryId: string | null; needsAi: boolean }> = [];

    const { service } = setup({
      listRules: async () => [{ categoryId: 'cat-politica', keyword: 'governo' }],
      minClassifyTextChars: 1,
      loadFeed: async () => ({
        notModified: false,
        status: 200,
        etag: null,
        lastModified: null,
        items: [
          {
            title: 'TJMT retoma expediente e mantem prazos suspensos',
            link: 'https://exemplo.com/tjmt',
            isoDate: '2026-09-28T10:00:00Z',
            contentSnippet: 'O Poder Judiciario de Mato Grosso retomou o expediente.',
            contentEncoded: 'Corpo do texto com a palavra governo apenas aqui dentro, fora do titulo e da descricao.',
          },
        ],
      }),
      news: {
        list: async () => ({ data: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0, hasNext: false, hasPrev: false } }),
        findById: async () => null,
        insertMany: async (articles) => {
          captured.push(...articles.map((a) => ({ title: a.title, categoryId: a.categoryId, needsAi: a.needsAi })));
          return { inserted: articles.length, duplicates: 0 };
        },
      },
    });

    await service.ingestSource(g1);

    // a keyword "governo" so existe no corpo: nao decide (categoria = padrao da
    // fonte, null) e o artigo vai para a fila da IA por ter texto suficiente.
    expect(captured).toEqual([
      { title: 'TJMT retoma expediente e mantem prazos suspensos', categoryId: null, needsAi: true },
    ]);
  });
});

describe('IngestionService.ingestAll', () => {
  it('agrega resultados de todas as fontes', async () => {
    const { service, state } = setup({
      loadFeed: async (source) => ({
        notModified: false,
        status: 200,
        etag: null,
        lastModified: null,
        items: [item(`${source.slug}-1`), item(`${source.slug}-2`)],
      }),
    });

    const report = await service.ingestAll();

    expect(report).toMatchObject({ sources: 2, inserted: 4, duplicates: 0, failed: 0 });
    expect(state.inserted.sort()).toEqual(['bbc-1', 'bbc-2', 'g1-1', 'g1-2']);
  });

  it('uma fonte quebrada nao derruba as outras', async () => {
    const { service } = setup({
      loadFeed: async (source) => {
        if (source.slug === 'g1') throw new ExternalServiceError('FEED_HTTP_ERROR', 'HTTP 503');
        return { notModified: false, status: 200, etag: null, lastModified: null, items: [item('Da BBC')] };
      },
    });

    const report = await service.ingestAll();

    expect(report).toMatchObject({ inserted: 1, failed: 1 });
    expect(report.results.find((r) => r.slug === 'g1')?.error).toContain('HTTP 503');
  });

  it('deduplica entre fontes diferentes pelo fingerprint', async () => {
    const { service } = setup({
      loadFeed: async () => ({ notModified: false, status: 200, etag: null, lastModified: null, items: [item('Mesma noticia')] }),
    });

    const report = await service.ingestAll();

    expect(report).toMatchObject({ inserted: 1, duplicates: 1 });
  });

  it('bloqueia execucoes concorrentes', async () => {
    const { service } = setup({
      loadFeed: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { notModified: false, status: 200, etag: null, lastModified: null, items: [] };
      },
    });

    const first = service.ingestAll();
    await expect(service.ingestAll()).rejects.toBeInstanceOf(ConflictError);
    await first;
  });
});
