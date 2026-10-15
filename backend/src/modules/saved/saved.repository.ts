import { ConflictError } from '../../core/errors.js';
import type { Database } from '../../db/pool.js';
import { isUniqueViolation } from '../../db/errors.js';
import { SELECT_ARTICLE_CARD, buildSearchClause, toArticle } from '../news/news.repository.js';
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

export type SavedListQuery = { page: number; limit: number; q?: string };

/** Vinculo a criar; `savedAt` preserva a data original (so vem no backup JSON). */
export type SaveEntry = { articleId: string; savedAt?: string | null };

/** Artigo de colecao: o Article com a data em que foi salvo (contexto de export). */
export type SavedArticle = Article & { savedAt: string };

export interface SavedRepository {
  listGroups(): Promise<NewsGroup[]>;
  findGroupById(id: string): Promise<NewsGroup | null>;
  /** Igualdade sem diferenciar maiusculas — o mesmo criterio do indice unico 007. */
  findGroupByName(name: string): Promise<NewsGroup | null>;
  createGroup(input: GroupInput): Promise<NewsGroup>;
  updateGroup(id: string, patch: GroupPatch): Promise<NewsGroup | null>;
  removeGroup(id: string): Promise<boolean>;
  /** Vinculo idempotente: salvar de novo nao duplica nem reordena. */
  save(groupId: string, articleId: string): Promise<void>;
  /** Import: resolve URL -> id das noticias que existem no banco. */
  findArticleIdsByUrls(urls: string[]): Promise<Map<string, string>>;
  /** Quais desses artigos ja estao na colecao (para reportar "ja estavam"). */
  listSavedArticleIds(groupId: string, articleIds: string[]): Promise<Set<string>>;
  /**
   * Vincula em massa; devolve quantos vinculos novos foram criados. `savedAt`
   * (opcional) fixa a data de salvamento original — vem do backup JSON; sem
   * ele o banco usa now(). So afeta vinculos NOVOS: um vinculo ja existente
   * mantem a sua data (reimportar nao reseta o salvamento).
   */
  saveMany(groupId: string, entries: SaveEntry[]): Promise<number>;
  unsave(groupId: string, articleId: string): Promise<void>;
  listGroupArticles(groupId: string, query: SavedListQuery): Promise<Paginated<Article>>;
  /** Todos os artigos do grupo (com savedAt) — para o export (limitado). */
  listGroupArticlesForExport(groupId: string, limit: number): Promise<SavedArticle[]>;
  /** Todas as noticias salvas, em qualquer grupo, sem repeticao. */
  listSaved(query: SavedListQuery): Promise<Paginated<Article>>;
  /** { articleId: [groupId] } — marca os cards sem tocar na consulta quente de /news. */
  listSavedIds(): Promise<Record<string, string[]>>;
  /**
   * Grava (ou limpa, com null) a anotacao pessoal da noticia. A nota vive em
   * articles, nao em saved_articles: ela e sobre a noticia e sobrevive a
   * desfazer o salvamento.
   */
  setNote(articleId: string, note: string | null): Promise<void>;
  /** Import de colecao: grava varias notas de uma vez. Devolve quantas foram aplicadas. */
  setNotes(entries: Array<{ articleId: string; note: string }>): Promise<number>;
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

  /** Import: reusa a colecao existente em vez de chocar com o indice unico (007). */
  async findGroupByName(name: string): Promise<NewsGroup | null> {
    const { rows } = await this.db.query(
      `${SELECT_GROUP} where lower(g.name) = lower($1) group by g.id limit 1`,
      [name],
    );
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

  /** URL -> id. Match exato: o export grava a URL como esta, entao o ciclo fecha. */
  async findArticleIdsByUrls(urls: string[]): Promise<Map<string, string>> {
    if (urls.length === 0) return new Map();
    const { rows } = await this.db.query<{ id: string; url: string }>(
      'select id, url from articles where url = any($1::text[])',
      [urls],
    );
    return new Map(rows.map((row) => [row.url, row.id]));
  }

  async listSavedArticleIds(groupId: string, articleIds: string[]): Promise<Set<string>> {
    if (articleIds.length === 0) return new Set();
    const { rows } = await this.db.query<{ article_id: string }>(
      'select article_id from saved_articles where group_id = $1 and article_id = any($2::uuid[])',
      [groupId, articleIds],
    );
    return new Set(rows.map((row) => row.article_id));
  }

  async saveMany(groupId: string, entries: SaveEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    const result = await this.db.query(
      `insert into saved_articles (group_id, article_id, saved_at)
       select $1, e.article_id, coalesce(e.saved_at, now())
         from unnest($2::uuid[], $3::timestamptz[]) as e(article_id, saved_at)
       on conflict do nothing`,
      [
        groupId,
        entries.map((entry) => entry.articleId),
        entries.map((entry) => entry.savedAt ?? null),
      ],
    );
    return result.rowCount ?? 0;
  }

  async listGroupArticles(groupId: string, query: SavedListQuery): Promise<Paginated<Article>> {
    // FTS da propria articles: mesma expressao de /news, apenas restringida ao grupo.
    const search = query.q ? buildSearchClause(query.q, 2) : null;
    const whereGroup = search ? `sa.group_id = $1 and ${search.clause}` : 'sa.group_id = $1';

    const counted = await this.db.query<{ total: number }>(
      `select count(*)::int as total
         from saved_articles sa
         join articles a on a.id = sa.article_id
        where ${whereGroup}`,
      [groupId, ...(search?.params ?? [])],
    );
    const total = counted.rows[0]?.total ?? 0;

    const params = [groupId, ...(search?.params ?? [])];
    const page = await this.db.query(
      `${SELECT_ARTICLE_CARD}
       join saved_articles sa on sa.article_id = a.id
       where ${whereGroup}
       order by sa.saved_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    return paginate(ARTICLE_ROWS(page.rows), total, query);
  }

  /** Export: todos os artigos do grupo (em ordem de salvamento) com savedAt. */
  async listGroupArticlesForExport(groupId: string, limit: number): Promise<SavedArticle[]> {
    // SELECT_ARTICLE_CARD comeca com o literal "select"; troco so esse prefixo
    // para incluir sa.saved_at — o alias "sa" vem do join logo abaixo, e o SQL
    // resolve os aliases do FROM contra o select, independentemente da ordem
    // textual. Guardo a posicao apos o "select" inicial (o lateral traz outro
    // "select *" mais adiante, que nao quero atingir).
    const select = `select sa.saved_at as saved_at,${SELECT_ARTICLE_CARD.slice('select'.length)}`;
    const { rows } = await this.db.query(
      `${select}
       join saved_articles sa on sa.article_id = a.id
       where sa.group_id = $1
       order by sa.saved_at desc
       limit $2`,
      [groupId, limit],
    );
    return (rows as GroupRow[]).map((row) => ({
      ...toArticle(row),
      savedAt: (row.saved_at as Date).toISOString(),
    }));
  }

  async listSaved(query: SavedListQuery): Promise<Paginated<Article>> {
    const saved = 'exists (select 1 from saved_articles sa where sa.article_id = a.id)';
    const search = query.q ? buildSearchClause(query.q, 1) : null;
    const where = search ? `${saved} and ${search.clause}` : saved;

    const counted = await this.db.query<{ total: number }>(
      `select count(*)::int as total from articles a where ${where}`,
      search?.params ?? [],
    );
    const total = counted.rows[0]?.total ?? 0;

    const params = search?.params ?? [];
    const page = await this.db.query(
      `${SELECT_ARTICLE_CARD}
       where ${where}
       order by a.published_at desc, a.id desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
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

  /** Nota e um campo da noticia: update direto, sem passar pelo vinculo de grupo. */
  async setNote(articleId: string, note: string | null): Promise<void> {
    await this.db.query('update articles set note = $2 where id = $1', [articleId, note]);
  }

  /**
   * Notas em lote (import). Um update por nota seria N round-trips; aqui vira
   * uma passada com unnest. Silenciosamente pula articleId inexistente — o
   * service ja filtra pelos ids que casaram por URL.
   */
  async setNotes(entries: Array<{ articleId: string; note: string }>): Promise<number> {
    if (entries.length === 0) return 0;
    const { rowCount } = await this.db.query(
      `update articles a
          set note = e.note
         from unnest($1::uuid[], $2::text[]) as e(article_id, note)
        where a.id = e.article_id`,
      [entries.map((entry) => entry.articleId), entries.map((entry) => entry.note)],
    );
    return rowCount ?? 0;
  }
}
