import { describe, expect, it } from 'vitest';
import type { Database } from '../../db/pool.js';
import { PgSavedRepository } from './saved.repository.js';

type Handler = (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number };

/** Falso banco: responde so o que o repositorio usa, guiado pelo SQL. */
function fakeDb(handler: Handler): Database {
  return {
    query: (async (sql: string, params?: unknown[]) => {
      const result = handler(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    }) as Database['query'],
  };
}

const articleRow = {
  id: 'a-1',
  title: 'Noticia salva',
  description: null,
  content: null,
  image_url: null,
  author: null,
  url: 'https://exemplo.com/1',
  published_at: new Date('2026-09-28T10:00:00Z'),
  ingested_at: new Date('2026-09-28T10:05:00Z'),
  category_method: null,
  category_confidence: null,
  source_id: 's-1',
  source_slug: 'g1',
  source_name: 'G1',
  source_site_url: null,
  category_id: null,
  category_slug: null,
  category_name: null,
  category_color: null,
  summary: null,
};

describe('PgSavedRepository', () => {
  it('mapeia os grupos com a contagem de salvos', async () => {
    const db = fakeDb((sql) => {
      if (sql.includes('insert into news_groups')) return { rows: [{ id: 'g-1' }] };
      if (sql.includes('from news_groups')) {
        return { rows: [{ id: 'g-1', name: 'Eleicoes 2026', color: '#112233', created_at: new Date('2026-01-01Z'), saved_count: 3 }] };
      }
      return { rows: [] };
    });

    const group = await new PgSavedRepository(db).createGroup({ name: 'Eleicoes 2026', color: '#112233' });

    expect(group).toMatchObject({ id: 'g-1', name: 'Eleicoes 2026', savedCount: 3 });
  });

  it('salva com on conflict do nothing (idempotente)', async () => {
    let seen: { sql: string; params?: unknown[] } | undefined;
    const db = fakeDb((sql, params) => {
      if (sql.includes('insert into saved_articles')) seen = { sql, params };
      return { rows: [] };
    });

    await new PgSavedRepository(db).save('g-1', 'a-1');

    expect(seen?.sql).toContain('on conflict do nothing');
    expect(seen?.params).toEqual(['g-1', 'a-1']);
  });

  it('agrupa os ids salvos por artigo', async () => {
    const db = fakeDb(() => ({
      rows: [
        { article_id: 'a-1', group_ids: ['g-1', 'g-2'] },
        { article_id: 'a-2', group_ids: ['g-1'] },
      ],
    }));

    await expect(new PgSavedRepository(db).listSavedIds()).resolves.toEqual({
      'a-1': ['g-1', 'g-2'],
      'a-2': ['g-1'],
    });
  });

  it('pagina os artigos de um grupo', async () => {
    const db = fakeDb((sql) => {
      if (sql.includes('count(*)')) return { rows: [{ total: 1 }] };
      return { rows: [articleRow] };
    });

    const page = await new PgSavedRepository(db).listGroupArticles('g-1', { page: 1, limit: 12 });

    expect(page.data[0]).toMatchObject({ id: 'a-1', title: 'Noticia salva' });
    expect(page.pagination).toMatchObject({ page: 1, limit: 12, total: 1, totalPages: 1, hasNext: false, hasPrev: false });
  });
});
