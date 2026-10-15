import express, { type Express } from 'express';
import request from 'supertest';
import AdmZip from 'adm-zip';
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

describe('GET /api/v1/news/:id/share-photo', () => {
  const ID = '22222222-2222-4222-8222-222222222222';
  const realFetch = globalThis.fetch;
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  afterEach(() => {
    globalThis.fetch = realFetch;
    container.newsRepository.findById = async () => null;
  });

  const withPhoto = (imageUrl: string | null) => {
    container.newsRepository.findById = async () => ({ id: ID, imageUrl }) as never;
  };

  it('404 quando a noticia nao existe', async () => {
    const response = await request(app).get(`/api/v1/news/${ID}/share-photo`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('404 quando a noticia nao tem foto', async () => {
    withPhoto(null);
    const response = await request(app).get(`/api/v1/news/${ID}/share-photo`);
    expect(response.status).toBe(404);
  });

  it('404 quando a URL da foto nao e http(s)', async () => {
    withPhoto('file:///etc/passwd');
    const response = await request(app).get(`/api/v1/news/${ID}/share-photo`);
    expect(response.status).toBe(404);
  });

  it('devolve os bytes com content-type e cache', async () => {
    withPhoto('https://cdn.exemplo.com/foto.jpg');
    globalThis.fetch = async () =>
      new Response(jpegBytes, { status: 200, headers: { 'content-type': 'image/jpeg; charset=binary' } });

    const response = await request(app).get(`/api/v1/news/${ID}/share-photo`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.equals(jpegBytes)).toBe(true);
  });

  it('404 quando o CDN responde com erro — nunca 500', async () => {
    withPhoto('https://cdn.exemplo.com/foto.jpg');
    globalThis.fetch = async () => new Response('sumiu', { status: 404 });

    const response = await request(app).get(`/api/v1/news/${ID}/share-photo`);
    expect(response.status).toBe(404);
  });

  it('404 quando o 200 do CDN nao e uma imagem', async () => {
    withPhoto('https://cdn.exemplo.com/foto.jpg');
    globalThis.fetch = async () =>
      new Response('<html>bloqueado</html>', { status: 200, headers: { 'content-type': 'text/html' } });

    const response = await request(app).get(`/api/v1/news/${ID}/share-photo`);
    expect(response.status).toBe(404);
  });

  it('400 para id invalido', async () => {
    const response = await request(app).get('/api/v1/news/abc/share-photo');
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
    expect(response.text).toContain('## Eleições 2026');
    expect(response.text).toContain('### TSE define calendário eleitoral');
    expect(response.text).toContain('[exemplo.com ↗](https://exemplo.com/tse-calendario)');
    // formato unico: sem descricao, sem resumo, sem fonte/data
    expect(response.text).not.toContain('Divulgação das datas oficiais.');
    expect(response.text).not.toContain('TSE divulgou o calendário.');
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

describe('GET /api/v1/groups/export-all', () => {
  const makeGroup = (id: string, name: string) =>
    ({ id, name, color: null, savedCount: 0, createdAt: new Date() }) as never;

  /** Binário cru: o superagent não sabe ler `application/zip` sozinho. */
  const getZip = (path: string) =>
    request(app)
      .get(path)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  it('devolve ZIP com pasta raiz e um .md por colecao', async () => {
    container.savedRepository.listGroups = async () =>
      [makeGroup('g-1', 'Eleições 2026'), makeGroup('g-2', 'Mobilidade Portugal')] as never;
    container.savedRepository.listGroupArticlesForExport = async (groupId: string) =>
      (groupId === 'g-1'
        ? [{ id: 'a-1', title: 'Sonda', url: 'https://exemplo.com/sonda', note: 'minha nota' }]
        : []) as never;

    const response = await getZip('/api/v1/groups/export-all');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="satelite-colecoes-\d{4}-\d{2}-\d{2}\.zip"/,
    );

    const zip = new AdmZip(response.body);
    expect(new Set(zip.getEntries().map((entry) => entry.entryName))).toEqual(
      new Set(['satelite-colecoes/eleicoes-2026.md', 'satelite-colecoes/mobilidade-portugal.md']),
    );

    const md = zip.readAsText('satelite-colecoes/eleicoes-2026.md');
    expect(md).toContain('## Eleições 2026');
    expect(md).toContain('### Sonda');
    expect(md).toContain('[exemplo.com ↗](https://exemplo.com/sonda)');
    expect(md).toContain('minha nota');

    // colecao vazia: so o titulo — o arquivo e fiel ao que existe
    expect(zip.readAsText('satelite-colecoes/mobilidade-portugal.md')).toBe('## Mobilidade Portugal\n');
  });

  it('slug repetido ganha sufixo -2', async () => {
    container.savedRepository.listGroups = async () =>
      [makeGroup('g-1', 'Eleições 2026'), makeGroup('g-2', 'Eleições 2026!')] as never;

    const response = await getZip('/api/v1/groups/export-all');
    const names = new AdmZip(response.body).getEntries().map((entry) => entry.entryName);

    expect(new Set(names)).toEqual(
      new Set(['satelite-colecoes/eleicoes-2026.md', 'satelite-colecoes/eleicoes-2026-2.md']),
    );
    expect(names).toHaveLength(2);
  });

  it('nenhuma colecao ainda gera um ZIP valido (vazio)', async () => {
    container.savedRepository.listGroups = async () => [] as never;

    const response = await getZip('/api/v1/groups/export-all');

    expect(response.status).toBe(200);
    expect(new AdmZip(response.body).getEntries()).toHaveLength(0);
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

  it('JSON preserva a data de salvamento (savedAt) no saveMany', async () => {
    const group = {
      id: '77777777-7777-7777-8777-777777777777',
      name: 'Missão Lunar',
      color: null,
      savedCount: 1,
      createdAt: new Date(),
    };
    const savedAt = '2026-09-28T10:05:00.000Z';
    let received: Array<{ articleId: string; savedAt?: string | null }> = [];
    container.savedRepository.findGroupByName = async () => group as never;
    container.savedRepository.findArticleIdsByUrls = async () =>
      new Map([['https://exemplo.com/sonda', 'a-1']]);
    container.savedRepository.listSavedArticleIds = async () => new Set<string>();
    container.savedRepository.saveMany = async (
      _groupId: string,
      entries: Array<{ articleId: string; savedAt?: string | null }>,
    ) => {
      received = entries;
      return entries.length;
    };

    const jsonBackup = JSON.stringify({
      data: {
        group: { name: 'Missão Lunar' },
        articles: [{ url: 'https://exemplo.com/sonda', savedAt }],
      },
    });

    const response = await request(app)
      .post('/api/v1/groups/import')
      .set('content-type', 'application/json')
      .send(jsonBackup);

    expect(response.status).toBe(201);
    expect(received).toEqual([{ articleId: 'a-1', savedAt }]);
  });
});

describe('GET /api/v1/groups/:id/export?format=json', () => {
  it('o backup inclui savedAt de cada noticia', async () => {
    const groupId = '88888888-8888-4888-8888-888888888888';
    container.savedRepository.findGroupById = async () =>
      ({
        id: groupId,
        name: 'Missão Lunar',
        color: null,
        savedCount: 1,
        createdAt: new Date(),
      }) as never;
    container.savedRepository.listGroupArticlesForExport = async () =>
      [
        {
          id: 'a-1',
          title: 'Sonda',
          url: 'https://exemplo.com/sonda',
          savedAt: '2026-09-28T10:05:00.000Z',
        },
      ] as never;

    const response = await request(app).get(`/api/v1/groups/${groupId}/export?format=json`);
    const payload = response.body as { data: { articles: Array<{ savedAt: string }> } };

    expect(response.status).toBe(200);
    expect(payload.data.articles[0]?.savedAt).toBe('2026-09-28T10:05:00.000Z');
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

describe('config em runtime (GET/PATCH /api/v1/settings/ai)', () => {
  // container proprio por teste: o PATCH daqui em memoria nao vaza para os
  // outros blocos deste arquivo
  function settingsApp() {
    const fresh = createContainer(env, logger, pool);
    return { app: createApp(fresh, logger), container: fresh };
  }

  it('GET devolve a config efetiva com chaves mascaradas + descritores + provedores', async () => {
    const { app } = settingsApp();

    const response = await request(app).get('/api/v1/settings/ai');

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.settings.provider).toBe('openrouter');
    expect(data.settings.providers.openrouter.apiKey).toMatch(/^••••/);
    expect(data.providers.map((provider: { id: string }) => provider.id)).toContain('groq');
    expect(data.fields.some((field: { key: string }) => field.key === 'classify.batch')).toBe(true);
    // a chave real (do .env do teste) nunca aparece na resposta
    expect(JSON.stringify(response.body)).not.toContain('sk-or-teste');
  });

  it('PATCH aplica na hora no mesmo container (services leem sem reiniciar)', async () => {
    const { app, container } = settingsApp();

    const response = await request(app).patch('/api/v1/settings/ai').send({ classify: { batch: 42 } });

    expect(response.status).toBe(200);
    expect(response.body.data.settings.classify.batch).toBe(42);
    expect(container.settings.ai().classify.batch).toBe(42);
  });

  it('PATCH troca o provedor e mascara a chave nova', async () => {
    const { app, container } = settingsApp();

    const response = await request(app)
      .patch('/api/v1/settings/ai')
      .send({ provider: 'groq', providers: { groq: { apiKey: 'gsk_nova_chave_abcd' } } });

    expect(response.status).toBe(200);
    expect(response.body.data.settings.provider).toBe('groq');
    expect(response.body.data.settings.providers.groq.apiKey).toBe('••••abcd');
    expect(container.settings.ai().provider).toBe('groq');
  });

  it('PATCH com cron invalido responde 400 VALIDATION_ERROR', async () => {
    const { app } = settingsApp();

    const response = await request(app).patch('/api/v1/settings/ai').send({ scheduler: { classifyCron: 'vadia' } });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH com campo com typo e recusado (strict)', async () => {
    const { app } = settingsApp();

    const response = await request(app).patch('/api/v1/settings/ai').send({ classfy: { batch: 1 } });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH trocando para provedor sem chave (nem .env nem banco) e 400', async () => {
    const { app } = settingsApp();

    const response = await request(app).patch('/api/v1/settings/ai').send({ provider: 'groq' });

    expect(response.status).toBe(400);
  });
});
