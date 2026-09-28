import { ConflictError } from '../../core/errors.js';
import { isUniqueViolation } from '../../db/errors.js';
import type { Database } from '../../db/pool.js';
import type { SourceInput, SourcePatch, SourceRecord } from './sources.types.js';

export interface SourcesRepository {
  list(): Promise<SourceRecord[]>;
  listEnabled(): Promise<SourceRecord[]>;
  findById(id: string): Promise<SourceRecord | null>;
  findBySlug(slug: string): Promise<SourceRecord | null>;
  create(input: SourceInput): Promise<SourceRecord>;
  update(id: string, patch: SourcePatch): Promise<SourceRecord | null>;
  remove(id: string): Promise<boolean>;
  /** Atualiza cache condicional e saude da fonte ao final de cada ingestao. */
  markFetched(
    id: string,
    patch: { etag?: string | null; lastModified?: string | null; status: string; error?: string | null },
  ): Promise<void>;
}

const SELECT = `
  select s.id, s.slug, s.name, s.feed_url, s.site_url, s.default_category_id, s.enabled,
         s.etag, s.last_modified, s.last_fetched_at, s.last_status, s.last_error, s.created_at,
         c.id as category_id, c.slug as category_slug, c.name as category_name, c.color as category_color
  from sources s
  left join categories c on c.id = s.default_category_id
`;

type SourceRow = Record<string, unknown>;

const toRecord = (row: SourceRow): SourceRecord => ({
  id: row.id as string,
  slug: row.slug as string,
  name: row.name as string,
  feedUrl: row.feed_url as string,
  siteUrl: (row.site_url as string | null) ?? null,
  defaultCategoryId: (row.default_category_id as string | null) ?? null,
  enabled: row.enabled as boolean,
  etag: (row.etag as string | null) ?? null,
  lastModified: (row.last_modified as string | null) ?? null,
  lastFetchedAt: (row.last_fetched_at as Date | null) ?? null,
  lastStatus: (row.last_status as string | null) ?? null,
  lastError: (row.last_error as string | null) ?? null,
  category: row.category_id
    ? {
        id: row.category_id as string,
        slug: row.category_slug as string,
        name: row.category_name as string,
        color: (row.category_color as string | null) ?? null,
      }
    : null,
  createdAt: row.created_at as Date,
});

const UPDATABLE: Record<string, string> = {
  name: 'name',
  feedUrl: 'feed_url',
  siteUrl: 'site_url',
  defaultCategoryId: 'default_category_id',
  enabled: 'enabled',
};

export class PgSourcesRepository implements SourcesRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<SourceRecord[]> {
    const { rows } = await this.db.query(`${SELECT} order by s.name`);
    return (rows as SourceRow[]).map(toRecord);
  }

  async listEnabled(): Promise<SourceRecord[]> {
    const { rows } = await this.db.query(`${SELECT} where s.enabled order by s.name`);
    return (rows as SourceRow[]).map(toRecord);
  }

  async findById(id: string): Promise<SourceRecord | null> {
    const { rows } = await this.db.query(`${SELECT} where s.id = $1`, [id]);
    return rows[0] ? toRecord(rows[0] as SourceRow) : null;
  }

  async findBySlug(slug: string): Promise<SourceRecord | null> {
    const { rows } = await this.db.query(`${SELECT} where s.slug = $1`, [slug]);
    return rows[0] ? toRecord(rows[0] as SourceRow) : null;
  }

  async create(input: SourceInput): Promise<SourceRecord> {
    const { rows } = await this.db
      .query(
        `insert into sources (slug, name, feed_url, site_url, default_category_id, enabled)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          input.slug,
          input.name,
          input.feedUrl,
          input.siteUrl ?? null,
          input.defaultCategoryId ?? null,
          input.enabled ?? true,
        ],
      )
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ConflictError('Ja existe uma fonte com esse slug');
        throw error;
      });

    const created = await this.findById((rows[0] as { id: string }).id);
    if (!created) throw new Error('fonte criada mas nao encontrada');
    return created;
  }

  async update(id: string, patch: SourcePatch): Promise<SourceRecord | null> {
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
    await this.db.query(`update sources set ${sets.join(', ')} where id = $${params.length}`, params);
    return this.findById(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db.query('delete from sources where id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async markFetched(
    id: string,
    patch: { etag?: string | null; lastModified?: string | null; status: string; error?: string | null },
  ): Promise<void> {
    await this.db.query(
      `update sources
          set last_fetched_at = now(),
              last_status = $2,
              last_error = $3,
              etag = coalesce($4, etag),
              last_modified = coalesce($5, last_modified)
        where id = $1`,
      [id, patch.status, patch.error ?? null, patch.etag ?? null, patch.lastModified ?? null],
    );
  }
}
