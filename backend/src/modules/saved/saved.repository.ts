import { ConflictError } from '../../core/errors.js';
import type { Database } from '../../db/pool.js';
import { isUniqueViolation } from '../../db/errors.js';
import { SELECT_ARTICLE, toArticle } from '../news/news.repository.js';
import type { Article, Paginated } from '../news/news.types.js';

/** Grupo tematico pessoal (nao confundir com categoria: um grupo atravessa categorias). */
export type NewsGroup = {
  id: string;
  name: string;
  color: string | null;
  savedCount: number;
  createdAt: Date;
};

export type GroupInput = { name: string; color?: string | null };
export type GroupPatch = Partial<GroupInput>;

export type SavedListQuery = { page: number; limit: number };

export interface SavedRepository {
  listGroups(): Promise<NewsGroup[]>;
  findGroupById(id: string): Promise<NewsGroup | null>;
  createGroup(input: GroupInput): Promise<NewsGroup>;
  updateGroup(id: string, patch: GroupPatch): Promise<NewsGroup | null>;
  removeGroup(id: string): Promise<boolean>;
  /** Vinculo idempotente: salvar de novo nao duplica nem reordena. */
  save(groupId: string, articleId: string): Promise<void>;
  unsave(groupId: string, articleId: string): Promise<void>;
  listGroupArticles(groupId: string, query: SavedListQuery): Promise<Paginated<Article>>;
  /** Todas as noticias salvas, em qualquer grupo, sem repeticao. */
  listSaved(query: SavedListQuery): Promise<Paginated<Article>>;
  /** { articleId: [groupId] } — marca os cards sem tocar na consulta quente de /news. */
  listSavedIds(): Promise<Record<string, string[]>>;
}

const SELECT_GROUP = `
  select g.id, g.name, g.color, g.created_at,
         count(sa.article_id)::int as saved_count
  from news_groups g
  left join saved_articles sa on sa.group_id = g.id
`;

type GroupRow = Record<string, unknown>;

const toGroup = (row: GroupRow): NewsGroup => ({
  id: row.id as string,
  name: row.name as string,
  color: (row.color as string | null) ?? null,
  savedCount: (row.saved_count as number) ?? 0,
  createdAt: row.created_at as Date,
});

const UPDATABLE: Record<string, string> = { name: 'name', color: 'color' };

const paginate = <T>(data: T[], total: number, query: SavedListQuery): Paginated<T> => {
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);
  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrev: query.page > 1,
    },
  };
};

const ARTICLE_ROWS = (rows: unknown[]): Article[] => (rows as GroupRow[]).map(toArticle);

export class PgSavedRepository implements SavedRepository {
  constructor(private readonly db: Database) {}

  async listGroups(): Promise<NewsGroup[]> {
    const { rows } = await this.db.query(`${SELECT_GROUP} group by g.id order by g.name`);
    return (rows as GroupRow[]).map(toGroup);
  }

  async findGroupById(id: string): Promise<NewsGroup | null> {
    const { rows } = await this.db.query(`${SELECT_GROUP} where g.id = $1 group by g.id`, [id]);
    return rows[0] ? toGroup(rows[0] as GroupRow) : null;
  }

  async createGroup(input: GroupInput): Promise<NewsGroup> {
    try {
      const { rows } = await this.db.query(
        `insert into news_groups (name, color) values ($1, $2) returning id`,
        [input.name, input.color ?? null],
      );
      const created = await this.findGroupById((rows[0] as { id: string }).id);
      if (!created) throw new Error('grupo criado mas nao encontrado');
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Ja existe um grupo com esse nome');
      throw error;
    }
  }

  async updateGroup(id: string, patch: GroupPatch): Promise<NewsGroup | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE)) {
      if (key in patch) {
        params.push((patch as Record<string, unknown>)[key] ?? null);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findGroupById(id);

    params.push(id);
    try {
      await this.db.query(`update news_groups set ${sets.join(', ')} where id = $${params.length}`, params);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Ja existe um grupo com esse nome');
      throw error;
    }
    return this.findGroupById(id);
  }

  async removeGroup(id: string): Promise<boolean> {
    const result = await this.db.query('delete from news_groups where id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async save(groupId: string, articleId: string): Promise<void> {
    await this.db.query(
      'insert into saved_articles (group_id, article_id) values ($1, $2) on conflict do nothing',
      [groupId, articleId],
    );
  }

  async unsave(groupId: string, articleId: string): Promise<void> {
    await this.db.query('delete from saved_articles where group_id = $1 and article_id = $2', [groupId, articleId]);
  }

  async listGroupArticles(groupId: string, query: SavedListQuery): Promise<Paginated<Article>> {
    const counted = await this.db.query<{ total: number }>(
      'select count(*)::int as total from saved_articles where group_id = $1',
      [groupId],
    );
    const total = counted.rows[0]?.total ?? 0;

    const page = await this.db.query(
      `${SELECT_ARTICLE}
       join saved_articles sa on sa.article_id = a.id
       where sa.group_id = $1
       order by sa.saved_at desc
       limit $2 offset $3`,
      [groupId, query.limit, (query.page - 1) * query.limit],
    );
    return paginate(ARTICLE_ROWS(page.rows), total, query);
  }

  async listSaved(query: SavedListQuery): Promise<Paginated<Article>> {
    const counted = await this.db.query<{ total: number }>(
      'select count(distinct article_id)::int as total from saved_articles',
    );
    const total = counted.rows[0]?.total ?? 0;

    const page = await this.db.query(
      `${SELECT_ARTICLE}
       where exists (select 1 from saved_articles sa where sa.article_id = a.id)
       order by a.published_at desc, a.id desc
       limit $1 offset $2`,
      [query.limit, (query.page - 1) * query.limit],
    );
    return paginate(ARTICLE_ROWS(page.rows), total, query);
  }

  async listSavedIds(): Promise<Record<string, string[]>> {
    const { rows } = await this.db.query<{ article_id: string; group_ids: string[] }>(
      'select article_id, array_agg(group_id) as group_ids from saved_articles group by article_id',
    );
    const map: Record<string, string[]> = {};
    for (const row of rows) map[row.article_id] = row.group_ids;
    return map;
  }
}
