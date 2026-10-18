import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FormEvent } from 'react';
import { useCreateGroup, useGroups, useSaveArticle, useSavedIds, useSuggestGroup, useUnsaveArticle } from '../hooks/useSatelite';

/**
 * Botao "salvar" com dialogo de colecoes. O estado de cada noticia vem de
 * useSavedIds (uma requisicao cacheada para todos os cards). A sugestao por IA
 * reusa o mesmo provider da classificacao e apenas pre-marca/propoe.
 */
export function SaveButton({ articleId }: { articleId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

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
      {
        onSuccess: (response) => {
          save.mutate({ groupId: response.data.id, articleId });
          setName('');
        },
      },
    );
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

  // rastreia se o dialog ja esteve aberto: o foco no botao (devolucao a11y ao
  // fechar) so acontece na transicao open true->false. Sem isso, a branch else
  // roda tambem no MOUNT (open ja e false), cada SaveButton foca a si mesmo, o
  // ultimo card rouba o foco (last-write-wins) e o browser rola a pagina ate
  // ele — a pagina "pulinha" para o final ao atualizar.
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const dialog = dialogRef.current;
      if (dialog) dialog.focus();
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      buttonRef.current?.focus();
    }
    return undefined;
  }, [open]);

  return (
    <span className="save">
      <button
        ref={buttonRef}
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
              <div className="save__pop" role="dialog" aria-modal="true" aria-label="Salvar em coleções" tabIndex={-1} ref={dialogRef}>
                <p className="save__title">Salvar em coleções</p>

                {groups.isPending ? (
                  <p className="faint small">Carregando…</p>
                ) : list.length === 0 ? (
                  <p className="faint small">Nenhuma coleção ainda. Crie a primeira abaixo.</p>
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

                <div className="save__divider" aria-hidden="true" />

                <button
                  type="button"
                  className="button button--sm"
                  onClick={runSuggest}
                  disabled={suggest.isPending}
                >
                  {suggest.isPending ? '✦ Sugerindo…' : '✦ Sugerir coleção'}
                </button>
                {suggest.error ? (
                  <p className="small" style={{ color: 'var(--danger)', marginTop: 'var(--sp-2)' }}>
                    {suggest.error.message}
                  </p>
                ) : null}

                <form className="row" style={{ marginTop: 'var(--sp-3)' }} onSubmit={submitNew}>
                  <input
                    className="input"
                    required
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Nova coleção (ex.: Eleições 2026)"
                    aria-label="Nome da nova coleção"
                  />
                  <button type="submit" className="button button--sm" disabled={createGroup.isPending || name.trim().length < 2}>
                    Criar
                  </button>
                </form>

                <button
                  type="button"
                  className="button button--sm button--ghost"
                  style={{ marginTop: 'var(--sp-3)', width: '100%' }}
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
