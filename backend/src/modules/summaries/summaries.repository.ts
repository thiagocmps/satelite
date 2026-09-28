import type { Database } from '../../db/pool.js';

export type SummaryRecord = {
  id: string;
  articleId: string;
  provider: string;
  model: string;
  promptVersion: string;
  language: string;
  summary: string | null;
  inputHash: string;
  status: 'ok' | 'error';
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SummarySave = {
  articleId: string;
  provider: string;
  model: string;
  promptVersion: string;
  language: string;
  inputHash: string;
  status: 'ok' | 'error';
  summary?: string | null;
  error?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
};

export interface SummariesRepository {
  find(articleId: string, model: string, promptVersion: string): Promise<SummaryRecord | null>;
  findLatest(articleId: string): Promise<SummaryRecord | null>;
  /** Upsert: (article_id, model, prompt_version) e a chave de idempotencia. */
  save(input: SummarySave): Promise<SummaryRecord>;
}

const SELECT = 'id, article_id, provider, model, prompt_version, language, summary, input_hash, status, error, tokens_in, tokens_out, latency_ms, created_at, updated_at';

const toRecord = (row: Record<string, unknown>): SummaryRecord => ({
  id: row.id as string,
  articleId: row.article_id as string,
  provider: row.provider as string,
  model: row.model as string,
  promptVersion: row.prompt_version as string,
  language: row.language as string,
  summary: (row.summary as string | null) ?? null,
  inputHash: row.input_hash as string,
  status: row.status as 'ok' | 'error',
  error: (row.error as string | null) ?? null,
  tokensIn: (row.tokens_in as number | null) ?? null,
  tokensOut: (row.tokens_out as number | null) ?? null,
  latencyMs: (row.latency_ms as number | null) ?? null,
  createdAt: row.created_at as Date,
  updatedAt: row.updated_at as Date,
});

export class PgSummariesRepository implements SummariesRepository {
  constructor(private readonly db: Database) {}

  async find(articleId: string, model: string, promptVersion: string): Promise<SummaryRecord | null> {
    const { rows } = await this.db.query(
      `select ${SELECT} from ai_summaries where article_id = $1 and model = $2 and prompt_version = $3`,
      [articleId, model, promptVersion],
    );
    return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
  }

  async findLatest(articleId: string): Promise<SummaryRecord | null> {
    const { rows } = await this.db.query(
      `select ${SELECT} from ai_summaries where article_id = $1
       order by (status = 'ok') desc, updated_at desc limit 1`,
      [articleId],
    );
    return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
  }

  async save(input: SummarySave): Promise<SummaryRecord> {
    const { rows } = await this.db.query(
      `insert into ai_summaries
         (article_id, provider, model, prompt_version, language, input_hash, status, summary, error, tokens_in, tokens_out, latency_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (article_id, model, prompt_version) do update set
         provider = excluded.provider,
         language = excluded.language,
         input_hash = excluded.input_hash,
         status = excluded.status,
         summary = excluded.summary,
         error = excluded.error,
         tokens_in = excluded.tokens_in,
         tokens_out = excluded.tokens_out,
         latency_ms = excluded.latency_ms,
         updated_at = now()
       returning ${SELECT}`,
      [
        input.articleId,
        input.provider,
        input.model,
        input.promptVersion,
        input.language,
        input.inputHash,
        input.status,
        input.summary ?? null,
        input.error ?? null,
        input.tokensIn ?? null,
        input.tokensOut ?? null,
        input.latencyMs ?? null,
      ],
    );
    return toRecord(rows[0] as Record<string, unknown>);
  }
}
