import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createContainer } from './container.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';

process.env.DATABASE_URL ??= 'postgres://satelite:satelite@localhost:5432/satelite';
process.env.OPENROUTER_API_KEY ??= 'sk-or-teste';
process.env.ENABLE_INGEST = 'false';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGINS = '';

const env = loadEnv();
const logger = createLogger(env);
// pool falso: nenhum teste deste arquivo toca o banco de verdade
const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as never;
const container = createContainer(env, logger, pool);

const emptyPagination = { page: 1, limit: 12, total: 0, totalPages: 0, hasNext: false, hasPrev: false };

// dublês mínimos dos repositórios usados pelas rotas de leitura
container.newsRepository.list = async () => ({ data: [], pagination: emptyPagination });
container.newsRepository.findById = async () => null;
container.categoriesRepository.list = async () => [];
container.sourcesRepository.list = async () => [];
container.summariesRepository.findLatest = async () => null;

const app: Express = createApp(container, logger);

describe('GET /api/v1/health', () => {
  it('responde ok sem tocar o banco', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'satelite-api' });
  });
});

describe('GET /api/v1/health/ready', () => {
  it('503 quando o banco falha', async () => {
    const broken = { ...container, pool: { query: async () => Promise.reject(new Error('down')) } } as never;
    const response = await request(createApp(broken, logger)).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unavailable');
  });
});

describe('GET /api/v1/news', () => {
  it('aplica os padroes de paginacao', async () => {
    let received: unknown;
    container.newsRepository.list = async (query) => {
      received = query;
      return { data: [], pagination: emptyPagination };
    };

    const response = await request(app).get('/api/v1/news');

    expect(response.status).toBe(200);
    expect(received).toMatchObject({ page: 1, limit: 12, sort: 'recent' });
    expect(response.body.pagination).toMatchObject({ total: 0 });
  });

  it('converte os filtros da query', async () => {
    let received: Record<string, unknown> = {};
    container.newsRepository.list = async (query) => {
      received = query as unknown as Record<string, unknown>;
      return { data: [], pagination: emptyPagination };
    };

    await request(app).get('/api/v1/news?q=eleicao&page=2&limit=5&sort=relevance&to=2026-09-28');

    expect(received).toMatchObject({ q: 'eleicao', page: 2, limit: 5, sort: 'relevance', to: '2026-09-28T23:59:59.999Z' });
  });

  it('rejeita limit acima do maximo', async () => {
    const response = await request(app).get('/api/v1/news?limit=500');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejeita data invertida', async () => {
    const response = await request(app).get('/api/v1/news?from=2026-09-28&to=2026-01-01');
    expect(response.status).toBe(400);
  });

  it('rejeita uuid invalido', async () => {
    const response = await request(app).get('/api/v1/news?category=nao-e-uuid');
    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/news/:id', () => {
  it('404 com payload padrao', async () => {
    const response = await request(app).get('/api/v1/news/11111111-1111-4111-8111-111111111111');
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('400 para id invalido', async () => {
    const response = await request(app).get('/api/v1/news/abc');
    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/news/:id/summary', () => {
  it('404 quando a noticia nao existe', async () => {
    const response = await request(app).post('/api/v1/news/11111111-1111-4111-8111-111111111111/summary');
    expect(response.status).toBe(404);
  });
});

describe('categorias', () => {
  it('rejeita payload invalido', async () => {
    const response = await request(app).post('/api/v1/categories').send({ name: 'x' });
    expect(response.status).toBe(400);
  });

  it('cria categoria valida', async () => {
    container.categoriesRepository.create = async (input) => ({
      id: 'cat-1',
      slug: input.slug ?? 'novo-tema',
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      articleCount: 0,
      createdAt: new Date(),
    });

    const response = await request(app)
      .post('/api/v1/categories')
      .send({ slug: 'novo-tema', name: 'Novo tema', color: '#112233' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ slug: 'novo-tema', name: 'Novo tema' });
  });
});

describe('fontes', () => {
  it('rejeita feed que nao e URL', async () => {
    const response = await request(app).post('/api/v1/sources').send({ slug: 'x', name: 'X', feedUrl: 'nao-e-url' });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/sources/export', () => {
  const oneSource = [
    {
      id: 's-1',
      slug: 'g1',
      name: 'G1 Globo',
      feedUrl: 'https://g1.globo.com/rss/g1/',
      siteUrl: 'https://g1.globo.com',
      defaultCategoryId: null,
      enabled: true,
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastStatus: 'ok',
      lastError: null,
      category: { id: 'c-1', slug: 'geral', name: 'Geral', color: null },
      createdAt: new Date(),
    },
  ];

  it('faz download em OPML por padrao', async () => {
    container.sourcesRepository.list = async () => oneSource as never;

    const response = await request(app).get('/api/v1/sources/export');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/x-opml');
    expect(response.headers['content-disposition']).toContain('attachment; filename="satelite-sources-');
    expect(response.text).toContain('<opml version="2.0">');
    expect(response.text).toContain('type="rss"');
    expect(response.text).toContain('xmlUrl="https://g1.globo.com/rss/g1/"');
  });

  it('gera JSON quando pedido', async () => {
    const response = await request(app).get('/api/v1/sources/export?format=json');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toContain('.json');
    expect(response.body.data[0]).toMatchObject({ slug: 'g1', name: 'G1 Globo' });
  });

  it('rejeita formato desconhecido', async () => {
    const response = await request(app).get('/api/v1/sources/export?format=csv');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/sources/import', () => {
  const originalList = container.sourcesRepository.list;
  const originalCreate = container.sourcesRepository.create;
  const originalCategoriesList = container.categoriesRepository.list;
  const store: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    store.length = 0;
    container.sourcesRepository.list = async () => store as never;
    container.sourcesRepository.create = async (input) => {
      const record = { id: `s-${store.length + 1}`, ...input, createdAt: new Date(), category: null };
      store.push(record);
      return record as never;
    };
    container.categoriesRepository.list = async () =>
      [
        { id: 'cat-tech', slug: 'tecnologia', name: 'Tecnologia', description: null, color: null, articleCount: 0, createdAt: new Date() },
      ] as never;
  });

  afterEach(() => {
    container.sourcesRepository.list = originalList;
    container.sourcesRepository.create = originalCreate;
    container.categoriesRepository.list = originalCategoriesList;
  });

  it('importa OPML em corpo cru e responde 201 com relatorio', async () => {
    const opml = `<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline type="rss" text="Meu Feed" xmlUrl="https://meu.com/feed" htmlUrl="https://meu.com" category="tecnologia"/>
</body></opml>`;

    const response = await request(app).post('/api/v1/sources/import').set('content-type', 'text/xml').send(opml);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ imported: 1, skipped: [] });
    expect(store[0]!).toMatchObject({
      slug: 'meu-feed',
      feedUrl: 'https://meu.com/feed',
      defaultCategoryId: 'cat-tech',
    });
  });

  it('skips (sem erro) feed existente e duplicado dentro do proprio arquivo', async () => {
    store.push({ id: 's0', slug: 'g1', name: 'G1', feedUrl: 'https://g1.globo.com/rss/g1/', enabled: true });
    const opml = `<opml><body>
      <outline type="rss" text="G1" xmlUrl="https://g1.globo.com/rss/g1/"/>
      <outline type="rss" text="Repetido" xmlUrl="https://g1.globo.com/rss/g1/"/>
    </body></opml>`;

    const response = await request(app).post('/api/v1/sources/import').set('content-type', 'text/xml').send(opml);

    expect(response.status).toBe(200); // nada importado
    expect(response.body.data.imported).toBe(0);
    expect(response.body.data.skipped).toHaveLength(2);
  });

  it('aceita o JSON do proprio export ({ data: [...] }) via application/json', async () => {
    const response = await request(app)
      .post('/api/v1/sources/import')
      .set('content-type', 'application/json')
      .send({ data: [{ slug: 'x', name: 'X', feedUrl: 'https://x.com/feed', enabled: false }] });

    expect(response.status).toBe(201);
    expect(response.body.data.imported).toBe(1);
    expect(store[0]!).toMatchObject({ feedUrl: 'https://x.com/feed', enabled: false, slug: 'x' });
  });

  it('rejeita corpo de formato desconhecido', async () => {
    const response = await request(app).post('/api/v1/sources/import').set('content-type', 'text/plain').send('banana');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('rotas inexistentes', () => {
  it('404 padronizado', async () => {
    const response = await request(app).get('/api/v1/nao-existe');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('seguranca basica', () => {
  it('nao expoe o header X-Powered-By', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('aplica headers do helmet', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
