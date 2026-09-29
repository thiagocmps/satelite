import { useState } from 'react';
import type { FormEvent } from 'react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorBox } from '../components/States';
import { suggestSlug } from '../components/Filters';
import {
  useAddCategoryRule,
  useCategories,
  useCategoryRules,
  useCreateCategory,
  useDeleteCategory,
  useDeleteCategoryRule,
} from '../hooks/useSatelite';

const COLORS = ['#64748b', '#0ea5e9', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#10b981', '#ec4899'];

export function CategoriesPage() {
  const categories = useCategories();
  const rules = useCategoryRules();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const addRule = useAddCategoryRule();
  const deleteRule = useDeleteCategoryRule();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [color, setColor] = useState(COLORS[0] ?? '#64748b');
  const [keyword, setKeyword] = useState('');
  const [keywordFor, setKeywordFor] = useState<string>('');

  const error = categories.error ?? createCategory.error ?? addRule.error;

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    createCategory.mutate(
      { slug: slug || suggestSlug(name), name, color },
      {
        onSuccess: () => {
          setName('');
          setSlug('');
        },
      },
    );
  }

  function submitRule(event: FormEvent, categoryId: string) {
    event.preventDefault();
    const value = keyword.trim();
    if (value.length < 2) return;
    addRule.mutate(
      { categoryId, keyword: value },
      {
        onSuccess: () => {
          setKeyword('');
          setKeywordFor('');
        },
      },
    );
  }

  const list = categories.data?.data ?? [];
  const allRules = rules.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Categorias"
        eyebrow="MISSÃO · MAPA DE TEMAS"
        description="Organize as noticias por tema. As palavras-chave sao aplicadas na ingestao: a regra que casar vence a categoria padrao da fonte."
      />

      {error ? <ErrorBox message={error.message} /> : null}

      <div className="stack">
        <section className="panel">
          <h2 className="panel__title">Nova categoria</h2>
          <p className="panel__hint">O slug e usado na URL e na API; se ficar vazio, geramos a partir do nome.</p>

          <form className="form-grid" onSubmit={submitCategory}>
            <div className="field">
              <label className="field__label" htmlFor="cat-nome">
                Nome
              </label>
              <input
                id="cat-nome"
                className="input"
                required
                minLength={2}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slug) setSlug(suggestSlug(event.target.value));
                }}
                placeholder="Mercados"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="cat-slug">
                Slug
              </label>
              <input
                id="cat-slug"
                className="input"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="mercados"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="cat-cor">
                Cor
              </label>
              <select id="cat-cor" className="select" value={color} onChange={(event) => setColor(event.target.value)}>
                {COLORS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" aria-hidden="true">
                &nbsp;
              </label>
              <button type="submit" className="button button--primary" disabled={createCategory.isPending || name.length < 2}>
                {createCategory.isPending ? 'Criando…' : 'Criar categoria'}
              </button>
            </div>
          </form>
        </section>

        {categories.isPending ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : list.length === 0 ? (
          <EmptyState title="Nenhuma categoria cadastrada" />
        ) : (
          <section className="panel">
            <h2 className="panel__title">Categorias e palavras-chave</h2>
            <p className="panel__hint">
              Remover uma categoria deixa as noticias sem categoria (o historico e preservado).
            </p>

            <div className="stack">
              {list.map((category) => {
                const own = allRules.filter((rule) => rule.categoryId === category.id);
                const open = keywordFor === category.id;

                return (
                  <div key={category.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                    <div className="row">
                      <span
                        aria-hidden="true"
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 4,
                          background: category.color ?? 'var(--border-strong)',
                        }}
                      />
                      <strong>{category.name}</strong>
                      <span className="mono">/{category.slug}</span>
                      <span className="badge">{category.articleCount} noticias</span>
                      <span className="spacer" />
                      <button
                        type="button"
                        className="button button--sm"
                        onClick={() => setKeywordFor(open ? '' : category.id)}
                      >
                        + palavra-chave
                      </button>
                      <button
                        type="button"
                        className="button button--sm button--danger"
                        onClick={() => deleteCategory.mutate(category.id)}
                        disabled={deleteCategory.isPending}
                      >
                        Remover
                      </button>
                    </div>

                    <div className="chips" style={{ marginTop: 'var(--sp-2)' }}>
                      {own.length === 0 ? <span className="faint small">sem palavras-chave</span> : null}
                      {own.map((rule) => (
                        <span key={rule.id} className="chip">
                          {rule.keyword}
                          <button
                            type="button"
                            aria-label={`Remover palavra-chave ${rule.keyword}`}
                            onClick={() => deleteRule.mutate({ categoryId: category.id, ruleId: rule.id })}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>

                    {open ? (
                      <form className="row" style={{ marginTop: 'var(--sp-2)' }} onSubmit={(event) => submitRule(event, category.id)}>
                        <input
                          className="input"
                          style={{ maxWidth: 280 }}
                          autoFocus
                          required
                          minLength={2}
                          value={keyword}
                          onChange={(event) => setKeyword(event.target.value)}
                          placeholder="ex.: mercado financeiro"
                          aria-label={`Nova palavra-chave para ${category.name}`}
                        />
                        <button type="submit" className="button button--sm" disabled={addRule.isPending}>
                          Adicionar
                        </button>
                        <button type="button" className="button button--sm button--ghost" onClick={() => setKeywordFor('')}>
                          Cancelar
                        </button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
