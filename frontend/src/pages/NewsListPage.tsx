import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { NewsFilters } from '../api/types';
import { Filters } from '../components/Filters';
import { NewsCard } from '../components/NewsCard';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { EmptyState, ErrorBox, SkeletonGrid } from '../components/States';
import { useCategories, useIngestNow, useSources } from '../hooks/useSatelite';
import { useNews } from '../hooks/useSatelite';

/** Filtros vivem na URL: link compartilhavel, voltar/avancar do navegador funciona. */
function useFiltersFromUrl(): [NewsFilters, (patch: Partial<NewsFilters>) => void, () => void] {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<NewsFilters>(
    () => ({
      q: params.get('q') ?? undefined,
      category: params.get('categoria') ?? undefined,
      source: params.get('fonte') ?? undefined,
      from: params.get('de') ?? undefined,
      to: params.get('ate') ?? undefined,
      sort: params.get('ordem') === 'relevance' ? 'relevance' : 'recent',
      page: Number(params.get('pagina') ?? '1') || 1,
      limit: 12,
    }),
    [params],
  );

  const update = useCallback(
    (patch: Partial<NewsFilters>) => {
      const next = new URLSearchParams(params);
      const set = (key: string, value: unknown, empty = '') => {
        if (value === undefined || value === null || value === '' || value === empty) next.delete(key);
        else next.set(key, String(value));
      };

      set('q', patch.q !== undefined ? patch.q : filters.q);
      set('categoria', patch.category !== undefined ? patch.category : filters.category);
      set('fonte', patch.source !== undefined ? patch.source : filters.source);
      set('de', patch.from !== undefined ? patch.from : filters.from);
      set('ate', patch.to !== undefined ? patch.to : filters.to);
      set('ordem', patch.sort !== undefined ? patch.sort : filters.sort, 'recent');
      set('pagina', patch.page !== undefined ? patch.page : 1, '1');

      setParams(next, { replace: true });
    },
    [params, filters, setParams],
  );

  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return [filters, update, clear];
}

export function NewsListPage() {
  const [filters, updateFilters, clearFilters] = useFiltersFromUrl();
  const news = useNews(filters);
  const categories = useCategories();
  const sources = useSources();
  const ingest = useIngestNow();

  const total = news.data?.pagination.total ?? 0;

  return (
    <>
      <PageHeader
        title="Noticias"
        description="Agregacao de fontes RSS publicas com busca e filtros."
        action={
          <button type="button" className="button" onClick={() => ingest.mutate({})} disabled={ingest.isPending}>
            {ingest.isPending ? (
              <>
                <span className="spinner" aria-hidden="true" /> Ingerindo…
              </>
            ) : (
              '⟳ Ingerir agora'
            )}
          </button>
        }
      />

      <Filters
        filters={filters}
        categories={categories.data?.data ?? []}
        sources={sources.data?.data ?? []}
        onChange={updateFilters}
        onClear={clearFilters}
      />

      {ingest.error ? (
        <p className="toast toast--error" style={{ marginBottom: 'var(--sp-4)' }} role="alert">
          {ingest.error.message}
        </p>
      ) : null}

      <div className="results-bar">
        <span>
          {news.isPending
            ? 'Carregando…'
            : `${total} ${total === 1 ? 'noticia' : 'noticias'}${filters.q ? ` para “${filters.q}”` : ''}`}
        </span>
        {news.isFetching && !news.isPending ? <span className="faint">atualizando…</span> : null}
      </div>

      {news.isPending ? <SkeletonGrid /> : null}

      {news.isError ? (
        <ErrorBox message={news.error.message} onRetry={() => void news.refetch()} />
      ) : null}

      {news.data && news.data.data.length === 0 ? (
        <EmptyState
          title="Nenhuma noticia encontrada"
          hint="Ajuste os filtros, amplie o periodo ou rode a ingestao pela pagina Fontes."
        />
      ) : null}

      {news.data && news.data.data.length > 0 ? (
        <>
          <div className="news-grid">
            {news.data.data.map((article) => (
              <NewsCard key={article.id} article={article} />
            ))}
          </div>
          <Pagination pagination={news.data.pagination} onPageChange={(page) => updateFilters({ page })} />
        </>
      ) : null}
    </>
  );
}
