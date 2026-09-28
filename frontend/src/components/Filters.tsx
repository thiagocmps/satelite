import { useEffect, useState } from 'react';
import type { Category, NewsFilters, Source } from '../api/types';
import { slugify } from '../utils/format';

type Props = {
  filters: NewsFilters;
  categories: Category[];
  sources: Source[];
  onChange: (patch: Partial<NewsFilters>) => void;
  onClear: () => void;
};

/** Barra de filtros. Estado local apenas para o campo de texto (debounce). */
export function Filters({ filters, categories, sources, onChange, onClear }: Props) {
  const [text, setText] = useState(filters.q ?? '');

  // acompanha a URL quando o usuario volta/avanca no historico
  useEffect(() => setText(filters.q ?? ''), [filters.q]);

  useEffect(() => {
    if (text === (filters.q ?? '')) return;
    const timer = setTimeout(() => onChange({ q: text.trim() || undefined }), 350);
    return () => clearTimeout(timer);
  }, [text, filters.q, onChange]);

  const active = Boolean(filters.q || filters.category || filters.source || filters.from || filters.to);

  return (
    <div className="filters">
      <div className="field">
        <label className="field__label" htmlFor="filtro-busca">
          Busca
        </label>
        <input
          id="filtro-busca"
          className="input"
          type="search"
          placeholder="Palavra-chave (ex.: inteligencia artificial)"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filtro-categoria">
          Categoria
        </label>
        <select
          id="filtro-categoria"
          className="select"
          value={filters.category ?? ''}
          onChange={(event) => onChange({ category: event.target.value || undefined })}
        >
          <option value="">Todas</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filtro-fonte">
          Fonte
        </label>
        <select
          id="filtro-fonte"
          className="select"
          value={filters.source ?? ''}
          onChange={(event) => onChange({ source: event.target.value || undefined })}
        >
          <option value="">Todas</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filtro-de">
          De
        </label>
        <input
          id="filtro-de"
          className="input"
          type="date"
          value={filters.from ?? ''}
          onChange={(event) => onChange({ from: event.target.value || undefined })}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filtro-ate">
          Ate
        </label>
        <input
          id="filtro-ate"
          className="input"
          type="date"
          value={filters.to ?? ''}
          onChange={(event) => onChange({ to: event.target.value || undefined })}
        />
      </div>

      <div className="filters__actions">
        <div className="field">
          <label className="field__label" htmlFor="filtro-ordem">
            Ordem
          </label>
          <select
            id="filtro-ordem"
            className="select"
            value={filters.sort ?? 'recent'}
            onChange={(event) => onChange({ sort: event.target.value as NewsFilters['sort'] })}
          >
            <option value="recent">Mais recentes</option>
            <option value="relevance">Mais relevantes</option>
          </select>
        </div>

        <button type="button" className="button" onClick={onClear} disabled={!active}>
          Limpar
        </button>
      </div>
    </div>
  );
}

/** Slug sugerido a partir do nome, usado no formulario de categorias. */
export function suggestSlug(name: string): string {
  return slugify(name);
}
