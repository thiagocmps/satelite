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

describe('GET /api/v1/groups/:id/export', () => {
  const groupId = '11111111-1111-4111-8111-111111111111';
  const group = {
    id: groupId,
    name: 'Eleições 2026',
    color: '#ff6b6b',
    savedCount: 1,
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
  };
  const article = {
    id: 'a-1',
    title: 'TSE define calendário eleitoral',
    description: 'Divulgação das datas oficiais.',
    content: null,
    imageUrl: null,
    author: 'Redação',
    url: 'https://exemplo.com/tse-calendario',
    publishedAt: '2026-10-02T09:00:00.000Z',
    ingestedAt: '2026-10-02T09:05:00.000Z',
    source: { id: 's-1', slug: 'g1', name: 'G1 Globo', siteUrl: 'https://g1.globo.com' },
    category: { id: 'c-1', slug: 'politica', name: 'Política', color: null },
    categoryMethod: 'ai',
    categoryConfidence: 0.9,
    summary: {
      text: 'TSE divulgou o calendário.',
      generatedByAi: true,
      provider: 'openrouter',
      model: 'modelo-teste',
      promptVersion: 'v1',
      language: 'pt-BR',
      createdAt: '2026-10-02T10:00:00.000Z',
      updatedAt: '2026-10-02T10:00:00.000Z',
      tokensIn: 10,
      tokensOut: 5,
    },
  };

  it('faz download em Markdown por padrao', async () => {
    container.savedRepository.findGroupById = async () => group as never;
    container.savedRepository.listGroupArticlesForExport = async () => [article] as never;

    const response = await request(app).get(`/api/v1/groups/${groupId}/export`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/markdown');
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="satelite-colecao-eleicoes-2026-',
    );
    expect(response.text).toContain('# Eleições 2026');
    expect(response.text).toContain('1 notícia · exportado de Satelite em');
    expect(response.text).toContain('## 1. TSE define calendário eleitoral');
    expect(response.text).toContain('[G1 Globo](https://g1.globo.com) · 2 de outubro de 2026 · Política');
    expect(response.text).toContain('> TSE divulgou o calendário.');
    expect(response.text).toContain('[Ler original](https://exemplo.com/tse-calendario)');
  });

  it('gera JSON quando pedido', async () => {
    const response = await request(app).get(`/api/v1/groups/${groupId}/export?format=json`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toContain('.json');
    expect(response.body.data.group.name).toBe('Eleições 2026');
    expect(response.body.data.articles[0].url).toBe('https://exemplo.com/tse-calendario');
  });

  it('404 quando o grupo nao existe', async () => {
    container.savedRepository.findGroupById = async () => null;

    const response = await request(app).get(`/api/v1/groups/${groupId}/export`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejeita formato desconhecido', async () => {
    const response = await request(app).get(`/api/v1/groups/${groupId}/export?format=csv`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/groups/import', () => {
  const markdown = `# Missão Lunar

1 notícia · exportado de Satelite em 1 de outubro de 2026

## 1. Sonda entra em órbita

[Agência](https://agencia.com) · 1 de outubro de 2026

[Ler original](https://exemplo.com/sonda)

## 2. Notícia fora do banco

[Agência](https://agencia.com) · 2 de outubro de 2026

[Ler original](https://exemplo.com/fora-do-banco)
`;

  it('importa o Markdown e devolve o relatorio', async () => {
    const group = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Missão Lunar',
      color: null,
      savedCount: 1,
      createdAt: new Date(),
    };
    container.savedRepository.findGroupByName = async () => null;
    container.savedRepository.createGroup = async () => group as never;
    container.savedRepository.findArticleIdsByUrls = async () =>
      new Map([['https://exemplo.com/sonda', 'a-1']]);
    container.savedRepository.listSavedArticleIds = async () => new Set<string>();
    container.savedRepository.saveMany = async () => 1;

    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/octet-stream')
      .send(markdown);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      group: { id: group.id, name: 'Missão Lunar' },
      total: 2,
      added: 1,
      already: 0,
      notFound: 1,
    });
    expect(response.body.data.missingTitles).toEqual(['Notícia fora do banco']);
  });

  it('reusa a colecao de mesmo nome em vez de criar outra', async () => {
    const group = {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'missão lunar',
      color: null,
      savedCount: 1,
      createdAt: new Date(),
    };
    let created = false;
    container.savedRepository.findGroupByName = async (name: string) =>
      name.toLowerCase() === 'missão lunar' ? group : null;
    container.savedRepository.createGroup = async () => {
      created = true;
      return group as never;
    };
    container.savedRepository.findArticleIdsByUrls = async () => new Map();
    container.savedRepository.listSavedArticleIds = async () => new Set<string>();
    container.savedRepository.saveMany = async () => 0;

    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/octet-stream')
      .send(markdown);

    expect(response.status).toBe(201);
    expect(created).toBe(false);
    expect(response.body.data.group.id).toBe(group.id);
    expect(response.body.data).toMatchObject({ total: 2, added: 0, notFound: 2 });
  });

  it('400 quando o arquivo nao tem titulo de colecao', async () => {
    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/octet-stream')
      .send('## 1. Sonda\n\n[Ler original](https://exemplo.com/sonda)');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toMatch(/titulo da colecao/);
  });

  it('400 quando o arquivo esta vazio', async () => {
    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/octet-stream')
      .send('   ');

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/vazio/);
  });

  it('aplica as notas dos itens que casaram por URL', async () => {
    const group = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Missão Lunar',
      color: null,
      savedCount: 1,
      createdAt: new Date(),
    };
    const noted: Array<{ articleId: string; note: string }> = [];
    container.savedRepository.findGroupByName = async () => group as never;
    container.savedRepository.findArticleIdsByUrls = async () =>
      new Map([['https://exemplo.com/sonda', 'a-1']]);
    container.savedRepository.listSavedArticleIds = async () => new Set<string>();
    container.savedRepository.saveMany = async () => 1;
    container.savedRepository.setNotes = async (entries: Array<{ articleId: string; note: string }>) => {
      noted.push(...entries);
      return entries.length;
    };

    const markdownWithNote = `# Missão Lunar

## 1. Sonda entra em órbita

**Anotação:**

conferir a resolução

[Ler original](https://exemplo.com/sonda)
`;

    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/octet-stream')
      .send(markdownWithNote);

    expect(response.status).toBe(201);
    expect(response.body.data.notesApplied).toBe(1);
    expect(noted).toEqual([{ articleId: 'a-1', note: 'conferir a resolução' }]);
  });

  it('nota vazia no arquivo nao apaga nota existente (setNotes nao e chamado)', async () => {
    const group = {
      id: '55555555-5555-5555-8555-555555555555',
      name: 'Missão Lunar',
      color: null,
      savedCount: 1,
      createdAt: new Date(),
    };
    let notesTouched = false;
    container.savedRepository.findGroupByName = async () => group as never;
    container.savedRepository.findArticleIdsByUrls = async () =>
      new Map([['https://exemplo.com/sonda', 'a-1']]);
    container.savedRepository.listSavedArticleIds = async () => new Set<string>();
    container.savedRepository.saveMany = async () => 1;
    container.savedRepository.setNotes = async () => {
      notesTouched = true;
      return 0;
    };

    const markdownEmptyNote = `# Missão Lunar

## 1. Sonda entra em órbita

**Anotação:**

[Ler original](https://exemplo.com/sonda)
`;

    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/octet-stream')
      .send(markdownEmptyNote);

    expect(response.status).toBe(201);
    expect(response.body.data.notesApplied).toBe(0);
    expect(notesTouched).toBe(false);
  });

  it('importa backup em JSON (round-trip do export)', async () => {
    const group = {
      id: '66666666-6666-6666-8666-666666666666',
      name: 'Missão Lunar',
      color: null,
      savedCount: 1,
      createdAt: new Date(),
    };
    const noted: Array<{ articleId: string; note: string }> = [];
    container.savedRepository.findGroupByName = async () => group as never;
    container.savedRepository.findArticleIdsByUrls = async () =>
      new Map([['https://exemplo.com/sonda', 'a-1']]);
    container.savedRepository.listSavedArticleIds = async () => new Set<string>();
    container.savedRepository.saveMany = async () => 1;
    container.savedRepository.setNotes = async (entries: Array<{ articleId: string; note: string }>) => {
      noted.push(...entries);
      return entries.length;
    };

    const jsonBackup = JSON.stringify({
      data: {
        group: { id: group.id, name: 'Missão Lunar', color: null },
        articles: [
          {
            id: 'a-1',
            title: 'Sonda entra em órbita',
            url: 'https://exemplo.com/sonda',
            note: 'nota multilinha:\n- um\n- dois',
          },
        ],
      },
    });

    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/json')
      .send(jsonBackup);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ total: 1, added: 1, notesApplied: 1 });
    expect(noted).toEqual([{ articleId: 'a-1', note: 'nota multilinha:\n- um\n- dois' }]);
  });

  it('400 quando o JSON esta malformado', async () => {
    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/json')
      .send('{ "data": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PUT /api/v1/saved/articles/:articleId/note', () => {
  const ARTICLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const MISSING_ID = '99999999-9999-4999-8999-999999999999';

  it('grava a nota e devolve o artigo', async () => {
    container.newsRepository.findById = async (id: string) => (id === ARTICLE_ID ? ({ id } as never) : null);
    const noted: Array<[string, string | null]> = [];
    container.savedRepository.setNote = async (articleId: string, note: string | null) => {
      noted.push([articleId, note]);
    };

    const response = await request(app)
      .put(`/api/v1/saved/articles/${ARTICLE_ID}/note`)
      .send({ note: 'conferir resolução' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ articleId: ARTICLE_ID, note: 'conferir resolução' });
    expect(noted).toEqual([[ARTICLE_ID, 'conferir resolução']]);
  });

  it('string vazia limpa a nota (null no banco)', async () => {
    container.newsRepository.findById = async (id: string) => (id === ARTICLE_ID ? ({ id } as never) : null);
    const noted: Array<[string, string | null]> = [];
    container.savedRepository.setNote = async (articleId: string, note: string | null) => {
      noted.push([articleId, note]);
    };

    const response = await request(app).put(`/api/v1/saved/articles/${ARTICLE_ID}/note`).send({ note: '   ' });

    expect(response.status).toBe(200);
    expect(noted).toEqual([[ARTICLE_ID, null]]);
  });

  it('404 para noticia inexistente', async () => {
    container.newsRepository.findById = async () => null;

    const response = await request(app).put(`/api/v1/saved/articles/${MISSING_ID}/note`).send({ note: 'x' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('400 quando a nota passa de 2000 caracteres', async () => {
    const response = await request(app)
      .put(`/api/v1/saved/articles/${ARTICLE_ID}/note`)
      .send({ note: 'x'.repeat(2001) });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 quando o corpo nao e um objeto com note', async () => {
    const response = await request(app).put(`/api/v1/saved/articles/${ARTICLE_ID}/note`).send({ texto: 'errado' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 quando o articleId nao e um UUID', async () => {
    const response = await request(app).put('/api/v1/saved/articles/a-1/note').send({ note: 'x' });

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
