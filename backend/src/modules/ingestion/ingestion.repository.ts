import type { Database } from '../../db/pool.js';

export type IngestionRun = {
  id: string;
  sourceId: string | null;
  sourceName?: string | null;
  status: 'running' | 'ok' | 'error' | 'skipped';
  httpStatus: number | null;
  notModified: boolean;
  fetched: number;
  inserted: number;
  duplicates: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type RunResult = {
  status: 'ok' | 'error' | 'skipped';
  httpStatus?: number | null;
  notModified?: boolean;
  fetched?: number;
  inserted?: number;
  duplicates?: number;
  error?: string | null;
};

export interface IngestionRunsRepository {
  start(sourceId: string | null): Promise<string>;
  finish(runId: string, result: RunResult): Promise<void>;
  list(limit: number, sourceId?: string): Promise<IngestionRun[]>;
}

const SELECT = `
  select r.id, r.source_id, s.name as source_name, r.status, r.http_status, r.not_modified,
         r.fetched, r.inserted, r.duplicates, r.error, r.started_at, r.finished_at
  from ingestion_runs r
  left join sources s on s.id = r.source_id
`;

const toRecord = (row: Record<string, unknown>): IngestionRun => ({
  id: row.id as string,
  sourceId: (row.source_id as string | null) ?? null,
  sourceName: (row.source_name as string | null) ?? null,
  status: row.status as IngestionRun['status'],
  httpStatus: (row.http_status as number | null) ?? null,
  notModified: row.not_modified as boolean,
  fetched: (row.fetched as number) ?? 0,
  inserted: (row.inserted as number) ?? 0,
  duplicates: (row.duplicates as number) ?? 0,
  error: (row.error as string | null) ?? null,
  startedAt: row.started_at as Date,
  finishedAt: (row.finished_at as Date | null) ?? null,
});

export class PgIngestionRunsRepository implements IngestionRunsRepository {
  constructor(private readonly db: Database) {}

  async start(sourceId: string | null): Promise<string> {
    const { rows } = await this.db.query(
      `insert into ingestion_runs (source_id, status) values ($1, 'running') returning id`,
      [sourceId],
    );
    return (rows[0] as { id: string }).id;
  }

  async finish(runId: string, result: RunResult): Promise<void> {
    await this.db.query(
      `update ingestion_runs
          set status = $2, http_status = $3, not_modified = $4, fetched = $5,
              inserted = $6, duplicates = $7, error = $8, finished_at = now()
        where id = $1`,
      [
        runId,
        result.status,
        result.httpStatus ?? null,
        result.notModified ?? false,
        result.fetched ?? 0,
        result.inserted ?? 0,
        result.duplicates ?? 0,
        result.error ?? null,
      ],
    );
  }

  async list(limit: number, sourceId?: string): Promise<IngestionRun[]> {
    const where = sourceId ? 'where r.source_id = $2' : '';
    const params = sourceId ? [limit, sourceId] : [limit];
    const { rows } = await this.db.query(`${SELECT} ${where} order by r.started_at desc limit $1`, params);
    return rows.map((row) => toRecord(row as Record<string, unknown>));
  }
}
