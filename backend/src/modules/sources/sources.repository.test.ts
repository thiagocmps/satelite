import { describe, expect, it } from 'vitest';
import type { Database } from '../../db/pool.js';
import { PgSourcesRepository } from './sources.repository.js';

/** Falso banco: só responde o que o repositorio usa. */
function fakeDb(fail?: () => unknown): Database {
  return {
    query: (async (sql: string) => {
      if (fail) fail();
      if (sql.includes('insert into sources')) return { rows: [{ id: 'source-1' }], rowCount: 1 };
      if (sql.includes('from sources')) {
        return {
          rows: [
            {
              id: 'source-1',
              slug: 'g1',
              name: 'G1',
              feed_url: 'https://g1.globo.com/rss/g1/',
              site_url: null,
              default_category_id: null,
              enabled: true,
              etag: null,
              last_modified: null,
              last_fetched_at: null,
              last_status: null,
              last_error: null,
              category_id: null,
              category_slug: null,
              category_name: null,
              category_color: null,
              created_at: new Date('2026-01-01T00:00:00Z'),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }) as Database['query'],
  };
}

describe('PgSourcesRepository', () => {
  it('cria a fonte e devolve o registro completo', async () => {
    const repository = new PgSourcesRepository(fakeDb());
    const source = await repository.create({ slug: 'g1', name: 'G1', feedUrl: 'https://g1.globo.com/rss/g1/' });
    expect(source.id).toBe('source-1');
    expect(source.slug).toBe('g1');
  });

  it('traduz violacao de unique em conflito (409) em vez de erro interno', async () => {
    const repository = new PgSourcesRepository(
      fakeDb(() => {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: 'sources_slug_key',
        });
      }),
    );

    await expect(
      repository.create({ slug: 'g1', name: 'G1 duplicada', feedUrl: 'https://g1.globo.com/rss/g1/' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });
});
