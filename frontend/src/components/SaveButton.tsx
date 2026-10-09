import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { FormEvent } from 'react';
import { useCreateGroup, useGroups, useSaveArticle, useSavedIds, useSuggestGroup, useUnsaveArticle } from '../hooks/useSatelite';

/**
 * Botao "salvar" com popover de grupos. O estado de cada noticia vem de
 * useSavedIds (uma requisicao cacheada para todos os cards). A sugestao por IA
 * reusa o mesmo provider da classificacao e apenas pre-marca/propoe.
 */
export function SaveButton({ articleId }: { articleId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const groups = useGroups();
  const savedIds = useSavedIds();
  const save = useSaveArticle();
  const unsave = useUnsaveArticle();
  const createGroup = useCreateGroup();
  const suggest = useSuggestGroup();

  const memberOf = savedIds.data?.data[articleId] ?? [];
  const isSaved = memberOf.length > 0;
  const list = groups.data?.data ?? [];

  function toggle(groupId: string, checked: boolean) {
    if (checked) save.mutate({ groupId, articleId });
    else unsave.mutate({ groupId, articleId });
  }

  function submitNew(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 2) return;
    createGroup.mutate(
      { name: value },
      { onSuccess: (response) => save.mutate({ groupId: response.data.id, articleId }) },
    );
    setName('');
  }

  function runSuggest() {
    suggest.mutate(articleId, {
      onSuccess: (response) => {
        const { groupId, newGroupName } = response.data;
        if (groupId) save.mutate({ groupId, articleId });
        else if (newGroupName) setName(newGroupName);
      },
    });
  }

  return (
    <span className="save">
      <button
        type="button"
        className={`button button--sm${isSaved ? ' button--primary' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {isSaved ? '★ Salvo' : '☆ Salvar'}
      </button>

      {open
        ? createPortal(
            <div className="save__overlay">
              <div className="save__backdrop" onClick={() => setOpen(false)} role="presentation" />
              <div className="save__pop" role="dialog" aria-label="Salvar em grupos">
                <p className="save__title">Salvar em grupos</p>

                {groups.isPending ? (
                  <p className="faint small">Carregando…</p>
                ) : list.length === 0 ? (
                  <p className="faint small">Nenhum grupo ainda. Crie o primeiro abaixo.</p>
                ) : (
                  <div className="save__list">
                    {list.map((group) => (
                      <label key={group.id} className="save__item">
                        <input
                          type="checkbox"
                          checked={memberOf.includes(group.id)}
                          onChange={(event) => toggle(group.id, event.target.checked)}
                        />
                        <span>{group.name}</span>
                      </label>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="button button--sm"
                  style={{ marginTop: 'var(--sp-2)' }}
                  onClick={runSuggest}
                  disabled={suggest.isPending}
                >
                  {suggest.isPending ? '✦ Sugerindo…' : '✦ Sugerir grupo'}
                </button>
                {suggest.error ? <p className="small" style={{ color: 'var(--danger)' }}>{suggest.error.message}</p> : null}

                <form className="row" style={{ marginTop: 'var(--sp-3)' }} onSubmit={submitNew}>
                  <input
                    className="input"
                    required
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Novo grupo (ex.: Eleicoes 2026)"
                    aria-label="Nome do novo grupo"
                  />
                  <button type="submit" className="button button--sm" disabled={createGroup.isPending || name.trim().length < 2}>
                    Criar
                  </button>
                </form>

                <button
                  type="button"
                  className="button button--sm button--ghost"
                  style={{ marginTop: 'var(--sp-2)' }}
                  onClick={() => setOpen(false)}
                >
                  Fechar
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
