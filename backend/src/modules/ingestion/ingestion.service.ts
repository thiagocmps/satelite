import type { Logger } from '../../config/logger.js';
import { ConflictError, errorMessage } from '../../core/errors.js';
import type { FeedLoader } from '../../integrations/rss/rss.types.js';
import { normalizeItem } from '../../integrations/rss/rss.normalize.js';
import type { NewsRepository } from '../news/news.repository.js';
import type { SourcesRepository } from '../sources/sources.repository.js';
import type { SourceRecord } from '../sources/sources.types.js';
import { buildCategoryIndex, matchCategory, type CategoryRuleEntry } from './category-matcher.js';
import type { IngestionRunsRepository } from './ingestion.repository.js';

export type SourceIngestionResult = {
  sourceId: string;
  slug: string;
  name: string;
  status: 'ok' | 'not_modified' | 'error';
  fetched: number;
  inserted: number;
  duplicates: number;
  error?: string;
};

export type IngestionReport = {
  startedAt: string;
  finishedAt: string;
  sources: number;
  inserted: number;
  duplicates: number;
  failed: number;
  results: SourceIngestionResult[];
};

export type IngestionDeps = {
  sources: SourcesRepository;
  news: NewsRepository;
  runs: IngestionRunsRepository;
  loadFeed: FeedLoader;
  listRules: () => Promise<{ categoryId: string; keyword: string }[]>;
  logger: Logger;
  concurrency: number;
};

/**
 * Orquestra a ingestao: uma fonte por vez (com concurrencia limitada), cada uma
 * registrada em ingestion_runs. A falha de uma fonte nunca interrompe as outras.
 */
export class IngestionService {
  #running = false;

  constructor(private readonly deps: IngestionDeps) {}

  get isRunning(): boolean {
    return this.#running;
  }

  async ingestAll(): Promise<IngestionReport> {
    if (this.#running) throw new ConflictError('Ja existe uma ingestao em andamento');
    this.#running = true;
    const startedAt = new Date();

    try {
      const sources = await this.deps.sources.listEnabled();
      const index = buildCategoryIndex(await this.deps.listRules());
      const results: SourceIngestionResult[] = [];
      let cursor = 0;
      const next = (): SourceRecord | undefined => {
        const source = sources[cursor];
        cursor += 1;
        return source;
      };

      const worker = async () => {
        for (let source = next(); source; source = next()) {
          try {
            results.push(await this.ingestSource(source, index));
          } catch (error) {
            results.push({
              sourceId: source.id,
              slug: source.slug,
              name: source.name,
              status: 'error',
              fetched: 0,
              inserted: 0,
              duplicates: 0,
              error: errorMessage(error),
            });
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.max(1, Math.min(this.deps.concurrency, sources.length)) }, worker),
      );

      return {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        sources: sources.length,
        inserted: results.reduce((sum, result) => sum + result.inserted, 0),
        duplicates: results.reduce((sum, result) => sum + result.duplicates, 0),
        failed: results.filter((result) => result.status === 'error').length,
        results,
      };
    } finally {
      this.#running = false;
    }
  }

  async ingestSource(source: SourceRecord, index?: CategoryRuleEntry[]): Promise<SourceIngestionResult> {
    const runId = await this.deps.runs.start(source.id);

    try {
      const feed = await this.deps.loadFeed(source);

      if (feed.notModified) {
        await this.deps.sources.markFetched(source.id, {
          etag: feed.etag,
          lastModified: feed.lastModified,
          status: 'not_modified',
        });
        await this.deps.runs.finish(runId, { status: 'skipped', httpStatus: 304, notModified: true });
        return { sourceId: source.id, slug: source.slug, name: source.name, status: 'not_modified', fetched: 0, inserted: 0, duplicates: 0 };
      }

      const rules = index ?? buildCategoryIndex(await this.deps.listRules());
      const normalized = feed.items
        .map((item) => normalizeItem(item, source))
        .filter((article): article is NonNullable<typeof article> => article !== null)
        .map((article) => ({
          ...article,
          // regra por palavra-chave tem precedencia; a categoria padrao da fonte e o fallback
          categoryId: matchCategory(`${article.title} ${article.description ?? ''}`, rules) ?? article.categoryId,
        }));

      const { inserted, duplicates } = await this.deps.news.insertMany(normalized);

      await this.deps.sources.markFetched(source.id, {
        etag: feed.etag,
        lastModified: feed.lastModified,
        status: 'ok',
      });
      await this.deps.runs.finish(runId, {
        status: 'ok',
        httpStatus: feed.status,
        fetched: feed.items.length,
        inserted,
        duplicates,
      });

      this.deps.logger.info(
        { source: source.slug, fetched: feed.items.length, inserted, duplicates },
        'ingestao concluida',
      );
      return { sourceId: source.id, slug: source.slug, name: source.name, status: 'ok', fetched: feed.items.length, inserted, duplicates };
    } catch (error) {
      const message = errorMessage(error);
      // registra a falha sem mascarar o erro original
      await this.deps.sources
        .markFetched(source.id, { status: 'error', error: message })
        .catch(() => undefined);
      await this.deps.runs.finish(runId, { status: 'error', error: message }).catch(() => undefined);
      this.deps.logger.warn({ source: source.slug, err: error }, 'ingestao falhou');
      throw error;
    }
  }
}
