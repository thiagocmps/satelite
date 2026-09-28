import type { Pagination as PaginationMeta } from '../api/types';

type Props = {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
};

export function Pagination({ pagination, onPageChange }: Props) {
  const { page, totalPages, total } = pagination;
  if (total === 0) return null;

  const first = (page - 1) * pagination.limit + 1;
  const last = Math.min(page * pagination.limit, total);

  return (
    <nav className="pagination" aria-label="Paginacao">
      <button
        type="button"
        className="button button--sm"
        onClick={() => onPageChange(page - 1)}
        disabled={!pagination.hasPrev}
      >
        ← Anterior
      </button>

      <span className="pagination__info">
        {first}–{last} de {total} · pagina {page} de {totalPages}
      </span>

      <button
        type="button"
        className="button button--sm"
        onClick={() => onPageChange(page + 1)}
        disabled={!pagination.hasNext}
      >
        Proxima →
      </button>
    </nav>
  );
}
