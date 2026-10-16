import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { SaveButton } from '../components/SaveButton';
import { ShareButton } from '../components/ShareButton';
import { SummaryPanel } from '../components/SummaryPanel';
import { ErrorBox } from '../components/States';
import { useArticle, useSavedIds, useUpdateNote } from '../hooks/useSatelite';
import { formatDateTime, hostFromUrl } from '../utils/format';

const PREVIEW_CHARS = 1200;
/** Anotacao: espera esse intervalo apos o usuario parar de digitar. */
const NOTE_DEBOUNCE_MS = 800;
const NOTE_MAX_CHARS = 2000;

export function NewsDetailPage() {
  const { id = '' } = useParams();
  const article = useArticle(id);
  const [expanded, setExpanded] = useState(false);

  const detail = article.data?.data;
  const savedIds = useSavedIds();
  // so vale a pena anotar uma noticia salva: a nota sobrevive a desfazer o
  // salvamento, mas o editor aparece so enquanto ela esta salva
  const isSaved = detail ? (savedIds.data?.data[detail.id]?.length ?? 0) > 0 : false;

  const updateNote = useUpdateNote(detail?.id ?? '');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSavedAt, setNoteSavedAt] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteArticleId = useRef<string | null>(null);

  // rascunho acompanha a nota do servidor quando o artigo muda; digitar depois
  // disso nao e sobrescrito (o efeito so roda na troca de id)
  useEffect(() => {
    if (!detail) return;
    if (noteArticleId.current === detail.id) return;
    noteArticleId.current = detail.id;
    setNoteDraft(detail.note ?? '');
    setNoteSavedAt(null);
  }, [detail]);

  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  /** Grava a nota (debounce): string vazia limpa. */
  function queueNoteSave(value: string) {
    setNoteDraft(value);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(
      () => {
        // nada a fazer: mesmo valor ja gravado
        if (value.trim() === (detail?.note ?? '').trim()) return;
        updateNote.mutate(value, {
          onSuccess: () =>
            setNoteSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
        });
      },
      NOTE_DEBOUNCE_MS,
    );
  }

  if (article.isPending) {
    return (
      <>
        <div className="skeleton" style={{ height: 32, width: '40%', marginBottom: 'var(--sp-4)' }} />
        <div className="skeleton" style={{ height: 220 }} />
      </>
    );
  }

  if (article.isError) {
    return <ErrorBox message={article.error.message} onRetry={() => void article.refetch()} />;
  }

  const data = article.data.data;
  const body = data.content ?? '';
  const clamped = body.length > PREVIEW_CHARS;
  const visible = clamped && !expanded ? `${body.slice(0, PREVIEW_CHARS)}…` : body;

  return (
    <>
      <Link className="detail__back" to="/">
        ← Voltar para as notícias
      </Link>

      <div className="detail">
        <article>
          <PageHeader
            title={data.title}
            description={
              <div className="detail__meta" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>
                <strong>{data.source.name}</strong>
                {data.category ? <span className="badge badge--category">{data.category.name}</span> : null}
                {data.categoryMethod === 'ai' ? (
                  <span className="faint small" title="Categoria atribuída por IA">
                    por IA{' '}
                    {data.categoryConfidence != null ? `${Math.round(data.categoryConfidence * 100)}% de confiança` : ''}
                  </span>
                ) : null}
                {data.categoryMethod === 'keyword' ? (
                  <span className="faint small">por palavra-chave</span>
                ) : null}
                <time dateTime={data.publishedAt}>{formatDateTime(data.publishedAt)}</time>
                {data.author ? <span>por {data.author}</span> : null}
              </div>
            }
          />

          {data.imageUrl ? (
            <img className="detail__image" src={data.imageUrl} alt="" referrerPolicy="no-referrer" />
          ) : null}

          {data.description ? <p className="detail__lead">{data.description}</p> : null}

          {body ? (
            <>
              <p className={`detail__content${clamped && !expanded ? ' detail__content--clamped' : ''}`}>{visible}</p>
              {clamped ? (
                <button
                  type="button"
                  className="button button--sm"
                  style={{ marginTop: 'var(--sp-3)' }}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? 'Mostrar menos' : 'Mostrar mais'}
                </button>
              ) : null}
            </>
          ) : (
            <p className="muted small">A fonte não disponibilizou o texto completo; resuma pelo link original.</p>
          )}

          <p className="row" style={{ marginTop: 'var(--sp-5)' }}>
            <a className="button" href={data.url} target="_blank" rel="noopener noreferrer">
              Ler a notícia original em {hostFromUrl(data.url)} ↗
            </a>
            <ShareButton article={data} />
            <SaveButton articleId={data.id} />
          </p>
        </article>

        <aside className="detail__aside">
          <SummaryPanel articleId={data.id} />

          {/*
            A nota mora na coluna do resumo (aside sticky): assim ela fica
            visivel enquanto o leitor percorre a materia inteira, nao so no
            fim do texto.
          */}
          {isSaved ? (
            <section className="note-panel" aria-label="Anotação pessoal">
              <p className="note-panel__head">
                <span className="note-panel__marker" aria-hidden="true">
                  ✎
                </span>
                Anotação
                <span className="spacer" />
                {noteSavedAt ? (
                  <span className="note-panel__status" role="status">
                    salva às {noteSavedAt}
                  </span>
                ) : updateNote.isPending ? (
                  <span className="note-panel__status" role="status">
                    salvando…
                  </span>
                ) : null}
              </p>
              <textarea
                className="note-panel__input"
                value={noteDraft}
                maxLength={NOTE_MAX_CHARS}
                rows={8}
                placeholder="Sua anotação sobre esta notícia — ela fica salva mesmo se você desfizer o salvamento."
                onChange={(event) => queueNoteSave(event.target.value)}
              />
              <p className="note-panel__foot">
                <span className="faint small">
                  {noteDraft.length > 1800 ? `${noteDraft.length}/${NOTE_MAX_CHARS}` : 'salva automaticamente'}
                </span>
                {noteDraft.trim() ? (
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    onClick={() => queueNoteSave('')}
                  >
                    Limpar
                  </button>
                ) : null}
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
