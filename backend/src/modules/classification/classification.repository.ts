import type { Database } from '../../db/pool.js';

export type PendingArticle = {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  categoryId: string | null;
};

export type ResolveVerdict = {
  /** null = mantem a categoria atual (sem decisao nova). */
  categoryId: string | null;
  method: 'keyword' | 'ai' | null;
  confidence: number | null;
  aiClassified: boolean;
};

export interface ClassificationRepository {
  listPending(limit: number): Promise<PendingArticle[]>;
  countPending(): Promise<number>;
  /** Encerra a pendencia: categoria, origem da decisao e confianca em uma query. */
  resolve(id: string, verdict: ResolveVerdict): Promise<void>;
}

export class PgClassificationRepository implements ClassificationRepository {
  constructor(private readonly db: Database) {}

  async listPending(limit: number): Promise<PendingArticle[]> {
    const { rows } = await this.db.query(
      `select id, title, description, content, category_id
         from articles
        where needs_ai
        order by ingested_at asc
        limit $1`,
      [limit],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      content: (row.content as string | null) ?? null,
      categoryId: (row.category_id as string | null) ?? null,
    }));
  }

  async countPending(): Promise<number> {
    const { rows } = await this.db.query<{ pending: number }>(
      'select count(*)::int as pending from articles where needs_ai',
    );
    return rows[0]?.pending ?? 0;
  }

  async resolve(id: string, verdict: ResolveVerdict): Promise<void> {
    await this.db.query(
      `update articles
          set category_id = case when $2::uuid is null then category_id else $2::uuid end,
              category_method = $3,
              category_confidence = $4,
              ai_classified_at = case when $5 then now() else ai_classified_at end,
              needs_ai = false
        where id = $1`,
      [id, verdict.categoryId, verdict.method, verdict.confidence, verdict.aiClassified],
    );
  }
}