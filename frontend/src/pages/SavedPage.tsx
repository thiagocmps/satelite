import { useState } from 'react';
import type { FormEvent } from 'react';
import { NewsCard } from '../components/NewsCard';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { EmptyState, ErrorBox, SkeletonGrid } from '../components/States';
import { useCreateGroup, useDeleteGroup, useGroups, useSavedArticles } from '../hooks/useSatelite';

export function SavedPage() {
  const groups = useGroups();
  const createGroup = useCreateGroup();
  const deleteGroup = useDeleteGroup();

  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [page, setPage] = useState(1);

  const articles = useSavedArticles(groupId || null, page);
  const list = groups.data?.data ?? [];
  const error = groups.error ?? articles.error ?? createGroup.error ?? deleteGroup.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 2) return;
    createGroup.mutate({ name: value }, { onSuccess: () => setName('') });
  }

  return (
    <>
      <PageHeader
        title="Salvos"
        eyebrow="MISSÃO · ARQUIVO PESSOAL"
        description="Guarde noticias em grupos tematicos. Um grupo atravessa categorias: 'Eleicoes 2026' pode juntar politica, economia e mundo."
      />

      {error ? <ErrorBox message={error.message} /> : null}

      <div className="stack">
        <section className="panel">
          <h2 className="panel__title">Novo grupo</h2>
          <p className="panel__hint">Escolha um nome curto e reconhecivel. Uma noticia pode estar em varios grupos.</p>
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label className="field__label" htmlFor="grupo-nome">
                Nome
              </label>
              <input
                id="grupo-nome"
                className="input"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Eleicoes 2026 Brasil"
              />
            </div>
            <div className="field">
              <label className="field__label" aria-hidden="true">
                &nbsp;
              </label>
              <button type="submit" className="button button--primary" disabled={createGroup.isPending || name.trim().length < 2}>
                {createGroup.isPending ? 'Criando…' : 'Criar grupo'}
              </button>
            </div>
          </form>

          {list.length > 0 ? (
            <div className="chips" style={{ marginTop: 'var(--sp-3)' }}>
              {list.map((group) => (
                <span key={group.id} className="chip">
                  {group.name}
                  <span className="faint"> · {group.savedCount}</span>
                  <button
                    type="button"
                    aria-label={`Remover grupo ${group.name}`}
                    onClick={() => {
                      if (groupId === group.id) setGroupId('');
                      deleteGroup.mutate(group.id);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <div className="field" style={{ maxWidth: 320 }}>
          <label className="field__label" htmlFor="grupo-filtro">
            Ver
          </label>
          <select
            id="grupo-filtro"
            className="select"
            value={groupId}
            onChange={(event) => {
              setGroupId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos os salvos</option>
            {list.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.savedCount})
              </option>
            ))}
          </select>
        </div>

        {articles.isPending ? <SkeletonGrid /> : null}

        {articles.data && articles.data.data.length === 0 ? (
          <EmptyState
            title="Nenhuma noticia salva aqui"
            hint="Use o botao 'Salvar' em qualquer noticia para guarda-la em um grupo."
          />
        ) : null}

        {articles.data && articles.data.data.length > 0 ? (
          <>
            <div className="news-grid">
              {articles.data.data.map((article) => (
                <NewsCard key={article.id} article={article} />
              ))}
            </div>
            <Pagination pagination={articles.data.pagination} onPageChange={setPage} />
          </>
        ) : null}
      </div>
    </>
  );
}
