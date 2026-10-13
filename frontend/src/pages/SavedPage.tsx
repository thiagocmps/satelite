import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { CollectionImportReport } from '../api/types';
import { exportGroupUrl } from '../api/satelite.api';
import { NewsCard } from '../components/NewsCard';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { EmptyState, ErrorBox, SkeletonGrid } from '../components/States';
import {
  useCreateGroup,
  useDeleteGroup,
  useGroups,
  useImportCollection,
  useSavedArticles,
  useUpdateGroup,
} from '../hooks/useSatelite';

/** Teto do arquivo de import (o backend tambem recusa acima de 2 MB). */
const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export function SavedPage() {
  const groups = useGroups();
  const createGroup = useCreateGroup();
  const deleteGroup = useDeleteGroup();
  const updateGroup = useUpdateGroup();
  const importCollection = useImportCollection();

  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [page, setPage] = useState(1);
  // Id da coleção em confirmação de exclusão — excluir é destrutivo (some com
  // os vínculos, não com as notícias), então um clique só arma, dois executam.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Renomear inline: id da coleção em edição e o rascunho do novo nome.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Busca nos salvos: valor do campo e versão já com debounce (mesmo ritmo do Filters).
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CollectionImportReport | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(query.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const articles = useSavedArticles(groupId || null, page, q);
  const list = groups.data?.data ?? [];
  const queryError =
    groups.error ??
    articles.error ??
    createGroup.error ??
    deleteGroup.error ??
    updateGroup.error ??
    importCollection.error;
  // erro de arquivo (tamanho) e erro de query no mesmo lugar
  const error = fileError ?? queryError?.message ?? null;
  const currentGroup = list.find((g) => g.id === groupId);
  const hasSearch = q.length > 0;
  const filtered = Boolean(currentGroup || hasSearch);
  // só mostra o campo quando há o que buscar (ou quando há busca a limpar)
  const showSearch = hasSearch || (articles.data?.pagination.total ?? 0) > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 2) return;
    createGroup.mutate({ name: value }, { onSuccess: () => setName('') });
  }

  function startRename(id: string, current: string) {
    setConfirmingId(null);
    setRenamingId(id);
    setRenameValue(current);
  }

  function saveRename(id: string) {
    const value = renameValue.trim();
    const current = list.find((group) => group.id === id);
    // sem mudanca ou nome invalido: so fecha a edicao
    if (!current || value.length < 2 || value === current.name) {
      setRenamingId(null);
      return;
    }
    updateGroup.mutate({ id, patch: { name: value } }, { onSuccess: () => setRenamingId(null) });
  }

  function clearAll() {
    setQuery('');
    setQ('');
    setGroupId('');
    setPage(1);
  }

  /** Lê o Markdown escolhido e manda pro backend (mesmo arranjo do import de fontes). */
  function onImportFileSelected(file: File | undefined, input: HTMLInputElement) {
    // zera antes de ler: assim o mesmo arquivo pode ser escolhido de novo
    input.value = '';
    if (!file) return;
    setFileError(null);
    setImportResult(null);

    if (file.size > IMPORT_MAX_BYTES) {
      setFileError(`"${file.name}" tem mais de 2 MB — exporte de novo com menos notícias.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        importCollection.mutate(reader.result, {
          onSuccess: (response) => setImportResult(response.data),
        });
      }
    };
    reader.onerror = () => setFileError(`Não consegui ler "${file.name}".`);
    reader.readAsText(file);
  }

  return (
    <>
      <PageHeader
        title="Coleções"
        eyebrow="MISSÃO · ARQUIVO PESSOAL"
        description="Organize notícias salvas em coleções. Uma coleção cruza categorias — política, economia e mundo podem estar juntos."
      />

      {error ? <ErrorBox message={error} /> : null}

      <div className="stack">
        {/* ------------------------------------------------------- criar */}
        <form className="collection-create" onSubmit={submit}>
          <input
            ref={createInputRef}
            className="input collection-create__input"
            required
            minLength={2}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nova coleção (ex.: Eleições 2026)"
            aria-label="Nome da nova coleção"
          />
          <button
            type="submit"
            className="button button--primary"
            disabled={createGroup.isPending || name.trim().length < 2}
          >
            {createGroup.isPending ? '✦ Criando…' : '✦ Criar coleção'}
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            onChange={(event) => onImportFileSelected(event.target.files?.[0], event.target)}
          />
          <button
            type="button"
            className="button collection-create__import"
            onClick={() => fileInput.current?.click()}
            disabled={importCollection.isPending}
            title="Importar coleção de um arquivo Markdown — o mesmo formato do Exportar"
            aria-label="Importar coleção de arquivo Markdown"
          >
            {importCollection.isPending ? (
              <>
                <span className="spinner" aria-hidden="true" /> Importando…
              </>
            ) : (
              '⇧ Importar .md'
            )}
          </button>
        </form>

        {importResult ? (
          <div className="toast toast--ok" role="status">
            <strong>
              {importResult.added > 0
                ? `${importResult.added} notícia${importResult.added === 1 ? '' : 's'} em “${importResult.group.name}”.`
                : `“${importResult.group.name}”: nada novo para importar.`}
            </strong>
            {importResult.already > 0 ? ` ${importResult.already} já estavam na coleção.` : ''}
            {importResult.notFound > 0 ? (
              <ul className="import-report__missing">
                <li className="small">
                  {importResult.notFound} não{' '}
                  {importResult.notFound === 1 ? 'estava' : 'estavam'} no banco (só entram aqui notícias já
                  ingeridas):
                </li>
                {importResult.missingTitles.map((title) => (
                  <li key={title} className="small">
                    {title}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* ---------------------------------------------------- coleções */}
        {list.length > 0 ? (
          <section>
            <p className="collection-section-label">Suas coleções · {list.length}</p>
            <div className="collection-grid">
              {list.map((group) => (
                <article
                  key={group.id}
                  className={`collection-card${groupId === group.id ? ' collection-card--active' : ''}`}
                >
                  <span className="collection-card__orbit" aria-hidden="true" />
                  {renamingId === group.id ? (
                    <input
                      className="input collection-card__title-input"
                      autoFocus
                      value={renameValue}
                      maxLength={80}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          saveRename(group.id);
                        }
                        if (event.key === 'Escape') setRenamingId(null);
                      }}
                      aria-label={`Novo nome da coleção ${group.name}`}
                    />
                  ) : (
                    <p className="collection-card__title">{group.name}</p>
                  )}
                  <p className="collection-card__meta">
                    <span className="collection-card__dot" aria-hidden="true" />
                    {group.savedCount} {group.savedCount === 1 ? 'notícia' : 'notícias'}
                  </p>

                  <div className="collection-card__actions">
                    {renamingId === group.id ? (
                      <>
                        <button
                          type="button"
                          className="button button--sm button--primary"
                          disabled={updateGroup.isPending || renameValue.trim().length < 2}
                          onClick={() => saveRename(group.id)}
                        >
                          {updateGroup.isPending ? 'Salvando…' : 'Salvar'}
                        </button>
                        <button
                          type="button"
                          className="button button--sm button--ghost"
                          onClick={() => setRenamingId(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : confirmingId === group.id ? (
                      <>
                        <span className="collection-card__confirm">Excluir?</span>
                        <button
                          type="button"
                          className="button button--sm button--danger"
                          onClick={() => {
                            if (groupId === group.id) setGroupId('');
                            deleteGroup.mutate(group.id);
                            setConfirmingId(null);
                          }}
                        >
                          Sim, excluir
                        </button>
                        <button
                          type="button"
                          className="button button--sm button--ghost"
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`button button--sm${groupId === group.id ? ' button--primary' : ' button--ghost'}`}
                          onClick={() => {
                            setGroupId(groupId === group.id ? '' : group.id);
                            setPage(1);
                          }}
                        >
                          {groupId === group.id ? '● Filtrando' : 'Ver artigos'}
                        </button>
                        <button
                          type="button"
                          className="button button--sm button--ghost"
                          aria-label={`Renomear coleção ${group.name}`}
                          onClick={() => startRename(group.id, group.name)}
                        >
                          Renomear
                        </button>
                        <a
                          className="button button--sm button--ghost"
                          href={exportGroupUrl(group.id)}
                          download
                          title="Baixar esta coleção em Markdown"
                        >
                          ↓ Exportar
                        </a>
                        <button
                          type="button"
                          className="button button--sm button--ghost collection-card__delete"
                          aria-label={`Excluir coleção ${group.name}`}
                          onClick={() => setConfirmingId(group.id)}
                        >
                          Excluir
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* ------------------------------------------------------ artigos */}
        <section>
          <div className="collection-section-header">
            <p className="collection-section-label">
              {currentGroup ? (
                <>Notícias em <strong>{currentGroup.name}</strong></>
              ) : (
                <>Notícias salvas</>
              )}
            </p>
            {filtered ? (
              <button type="button" className="button button--sm button--ghost" onClick={clearAll}>
                ✕ limpar busca e filtro
              </button>
            ) : null}
          </div>

          {showSearch ? (
            <input
              className="input saved-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nesta lista (título, resumo e conteúdo)"
              aria-label="Buscar notícias salvas"
            />
          ) : null}

          {articles.isPending ? <SkeletonGrid /> : null}

          {articles.data && articles.data.data.length === 0 ? (
            <EmptyState
              title={
                hasSearch
                  ? `Nada encontrado para “${q}”`
                  : currentGroup
                    ? 'Nenhuma notícia nesta coleção'
                    : 'Nenhuma notícia salva ainda'
              }
              hint={
                hasSearch
                  ? 'A busca varre título, resumo e texto completo das notícias salvas.'
                  : list.length === 0
                    ? 'Crie uma coleção e use o botão “Salvar” em qualquer notícia para guardá-la aqui.'
                    : "Use o botão “Salvar” em qualquer notícia para adicioná-la a uma coleção."
              }
              action={
                filtered ? (
                  <button type="button" className="button button--sm" onClick={clearAll}>
                    ✕ Limpar busca e filtro
                  </button>
                ) : list.length === 0 ? (
                  <button
                    type="button"
                    className="button button--sm button--primary"
                    onClick={() => createInputRef.current?.focus()}
                  >
                    ✦ Criar primeira coleção
                  </button>
                ) : null
              }
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
        </section>
      </div>
    </>
  );
}
