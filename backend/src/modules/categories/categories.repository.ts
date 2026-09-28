import type { Database } from '../../db/pool.js';
import { isUniqueViolation } from '../../db/errors.js';
import { ConflictError } from '../../core/errors.js';

export type CategoryRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  articleCount: number;
  createdAt: Date;
};

export type CategoryRule = {
  id: string;
  categoryId: string;
  keyword: string;
  createdAt: Date;
};

export type CategoryInput = {
  slug?: string;
  name: string;
  description?: string | null;
  color?: string | null;
};

export type CategoryPatch = Partial<CategoryInput>;

export interface CategoriesRepository {
  list(): Promise<CategoryRecord[]>;
  findById(id: string): Promise<CategoryRecord | null>;
  findBySlug(slug: string): Promise<CategoryRecord | null>;
  create(input: CategoryInput): Promise<CategoryRecord>;
  update(id: string, patch: CategoryPatch): Promise<CategoryRecord | null>;
  remove(id: string): Promise<boolean>;
  listRules(categoryId?: string): Promise<CategoryRule[]>;
  addRule(categoryId: string, keyword: string): Promise<CategoryRule>;
  removeRule(id: string): Promise<boolean>;
}

const SELECT = `
  select c.id, c.slug, c.name, c.description, c.color, c.created_at,
         count(a.id)::int as article_count
  from categories c
  left join articles a on a.category_id = c.id
`;

type CategoryRow = Record<string, unknown>;

const toRecord = (row: CategoryRow): CategoryRecord => ({
  id: row.id as string,
  slug: row.slug as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  color: (row.color as string | null) ?? null,
  articleCount: (row.article_count as number) ?? 0,
  createdAt: row.created_at as Date,
});

const toRule = (row: Record<string, unknown>): CategoryRule => ({
  id: row.id as string,
  categoryId: row.category_id as string,
  keyword: row.keyword as string,
  createdAt: row.created_at as Date,
});

const UPDATABLE: Record<string, string> = { name: 'name', description: 'description', color: 'color' };

export class PgCategoriesRepository implements CategoriesRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<CategoryRecord[]> {
    const { rows } = await this.db.query(`${SELECT} group by c.id order by c.name`);
    return (rows as CategoryRow[]).map(toRecord);
  }

  async findById(id: string): Promise<CategoryRecord | null> {
    const { rows } = await this.db.query(`${SELECT} where c.id = $1 group by c.id`, [id]);
    return rows[0] ? toRecord(rows[0] as CategoryRow) : null;
  }

  async findBySlug(slug: string): Promise<CategoryRecord | null> {
    const { rows } = await this.db.query(`${SELECT} where c.slug = $1 group by c.id`, [slug]);
    return rows[0] ? toRecord(rows[0] as CategoryRow) : null;
  }

  async create(input: CategoryInput): Promise<CategoryRecord> {
    try {
      const { rows } = await this.db.query(
        `insert into categories (slug, name, description, color) values ($1, $2, $3, $4) returning id`,
        [input.slug, input.name, input.description ?? null, input.color ?? null],
      );
      const created = await this.findById((rows[0] as { id: string }).id);
      if (!created) throw new Error('categoria criada mas nao encontrada');
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Ja existe uma categoria com esse nome ou slug');
      throw error;
    }
  }

  async update(id: string, patch: CategoryPatch): Promise<CategoryRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE)) {
      if (key in patch) {
        params.push((patch as Record<string, unknown>)[key] ?? null);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.findById(id);

    params.push(id);
    try {
      await this.db.query(`update categories set ${sets.join(', ')} where id = $${params.length}`, params);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Ja existe uma categoria com esse nome');
      throw error;
    }
    return this.findById(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db.query('delete from categories where id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listRules(categoryId?: string): Promise<CategoryRule[]> {
    const where = categoryId ? 'where category_id = $1' : '';
    const params = categoryId ? [categoryId] : [];
    const { rows } = await this.db.query(
      `select id, category_id, keyword, created_at from category_rules ${where}
       order by char_length(keyword) desc, keyword`,
      params,
    );
    return rows.map(toRule);
  }

  async addRule(categoryId: string, keyword: string): Promise<CategoryRule> {
    const { rows } = await this.db.query(
      `insert into category_rules (category_id, keyword) values ($1, $2)
       on conflict (category_id, keyword) do update set keyword = excluded.keyword
       returning id, category_id, keyword, created_at`,
      [categoryId, keyword],
    );
    return toRule(rows[0] as Record<string, unknown>);
  }

  async removeRule(id: string): Promise<boolean> {
    const result = await this.db.query('delete from category_rules where id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
