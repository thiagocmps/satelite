import type { Database } from '../../db/pool.js';
import type { Article, NewsListQuery, NormalizedArticle, Paginated, SummaryView } from './news.types.js';

export interface NewsRepository {
  findById(id: string): Promise<Article | null>;
  list(query: NewsListQuery): Promise<Paginated<Article>>;
  /**
   * Insercao em lote. `on conflict do nothing` e a garantia final de dedup:
   * duas instancias ingerindo a mesma noticia ao mesmo tempo nao criam duplicata.
   */
  insertMany(articles: NormalizedArticle[]): Promise<{ inserted: number; duplicates: number }>;
}

const SELECT_ARTICLE = `
  select a.id, a.title, a.description, a.content, a.image_url, a.author, a.url, a.published_at, a.ingested_at,
         s.id as source_id, s.slug as source_slug, s.name as source_name, s.site_url as source_site_url,
         c.id as category_id, c.slug as category_slug, c.name as category_name, c.color as category_color,
         sm.summary, sm.provider, sm.model, sm.prompt_version, sm.language as summary_language,
         sm.created_at as summary_created_at, sm.updated_at as summary_updated_at,
         sm.tokens_in, sm.tokens_out
  from articles a
  join sources s on s.id = a.source_id
  left join categories c on c.id = a.category_id
  left join lateral (
    select * from ai_summaries x
     where x.article_id = a.id
     order by (x.status = 'ok') desc, x.updated_at desc
     limit 1
  ) sm on true
`;

const INSERT_COLUMNS = [
  'source_id',
  'category_id',
  'title',
  'description',
  'content',
  'image_url',
  'author',
  'url',
  'url_hash',
  'fingerprint',
  'published_at',
] as const;

const CHUNK_SIZE = 400; // 11 colunas x 400 = 4400 params, abaixo do limite de 65535 do Postgres

/** Valores na mesma ordem de INSERT_COLUMNS. */
const rowValues = (article: NormalizedArticle): unknown[] => [
  article.sourceId,
  article.categoryId,
  article.title,
  article.description,
  article.content,
  article.imageUrl,
  article.author,
  article.url,
  article.urlHash,
  article.fingerprint,
  article.publishedAt,
];

type ArticleRow = Record<string, unknown>;

const toSummary = (row: ArticleRow): SummaryView | null => {
  if (!row.summary) return null;
  return {
    text: row.summary as string,
    generatedByAi: true,
    provider: row.provider as string,
    model: row.model as string,
    promptVersion: row.prompt_version as string,
    language: row.summary_language as string,
    createdAt: (row.summary_created_at as Date).toISOString(),
    updatedAt: (row.summary_updated_at as Date).toISOString(),
    tokensIn: (row.tokens_in as number | null) ?? null,
    tokensOut: (row.tokens_out as number | null) ?? null,
  };
};

const toArticle = (row: ArticleRow): Article => ({
  id: row.id as string,
  title: row.title as string,
  description: (row.description as string | null) ?? null,
  content: (row.content as string | null) ?? null,
  imageUrl: (row.image_url as string | null) ?? null,
  author: (row.author as string | null) ?? null,
  url: row.url as string,
  publishedAt: (row.published_at as Date).toISOString(),
  ingestedAt: (row.ingested_at as Date).toISOString(),
  source: {
    id: row.source_id as string,
    slug: row.source_slug as string,
    name: row.source_name as string,
    siteUrl: (row.source_site_url as string | null) ?? null,
  },
  category: row.category_id
    ? {
        id: row.category_id as string,
        slug: row.category_slug as string,
        name: row.category_name as string,
        color: (row.category_color as string | null) ?? null,
      }
    : null,
  summary: toSummary(row),
});

/** Clausula WHERE compartilhada entre a contagem e a pagina de resultados. */
export function buildFilters(query: NewsListQuery): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];

  if (query.q) {
    params.push(query.q);
    // tsvector usa o indice GIN; o ILIKE cobre prefixos que o stemming nao encontra.
    parts.push(`(a.search_vector @@ websearch_to_tsquery('portuguese', $1::text) or a.title ilike '%' || $1::text || '%')`);
  }
  if (query.categoryId) {
    params.push(query.categoryId);
    parts.push(`a.category_id = $${params.length}`);
  }
  if (query.sourceId) {
    params.push(query.sourceId);
    parts.push(`a.source_id = $${params.length}`);
  }
  if (query.from) {
    params.push(query.from);
    parts.push(`a.published_at >= $${params.length}::timestamptz`);
  }
  if (query.to) {
    params.push(query.to);
    parts.push(`a.published_at <= $${params.length}::timestamptz`);
  }

  return { clause: parts.length ? `where ${parts.join(' and ')}` : '', params };
}

export class PgNewsRepository implements NewsRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Article | null> {
    const { rows } = await this.db.query(`${SELECT_ARTICLE} where a.id = $1`, [id]);
    return rows[0] ? toArticle(rows[0] as ArticleRow) : null;
  }

  async list(query: NewsListQuery): Promise<Paginated<Article>> {
    const { clause, params } = buildFilters(query);
    const byRelevance = query.sort === 'relevance' && Boolean(query.q);
    const orderBy = byRelevance
      ? `ts_rank(a.search_vector, websearch_to_tsquery('portuguese', $1::text)) desc, a.published_at desc`
      : 'a.published_at desc, a.id desc';

    const counted = await this.db.query<{ total: number }>(
      `select count(*)::int as total from articles a ${clause}`,
      params,
    );
    const total = counted.rows[0]?.total ?? 0;

    const page = await this.db.query(
      `${SELECT_ARTICLE} ${clause} order by ${orderBy} limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);
    return {
      data: (page.rows as ArticleRow[]).map(toArticle),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNext: query.page < totalPages,
        hasPrev: query.page > 1,
      },
    };
  }

  async insertMany(articles: NormalizedArticle[]): Promise<{ inserted: number; duplicates: number }> {
    let inserted = 0;

    for (let offset = 0; offset < articles.length; offset += CHUNK_SIZE) {
      const chunk = articles.slice(offset, offset + CHUNK_SIZE);
      const values: unknown[] = [];
      const rows = chunk.map((article, index) => {
        const start = index * INSERT_COLUMNS.length;
        values.push(...rowValues(article));
        const placeholders = INSERT_COLUMNS.map((_, column) => `$${start + column + 1}`);
        return `(${placeholders.join(', ')})`;
      });

      const result = await this.db.query(
        `insert into articles (${INSERT_COLUMNS.join(', ')}) values ${rows.join(', ')} on conflict do nothing returning id`,
        values,
      );
      inserted += result.rowCount ?? 0;
    }

    return { inserted, duplicates: articles.length - inserted };
  }
}
