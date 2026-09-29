import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { SummaryPanel } from '../components/SummaryPanel';
import { ErrorBox } from '../components/States';
import { useArticle } from '../hooks/useSatelite';
import { formatDateTime, hostFromUrl } from '../utils/format';

const PREVIEW_CHARS = 1200;

export function NewsDetailPage() {
  const { id = '' } = useParams();
  const article = useArticle(id);
  const [expanded, setExpanded] = useState(false);

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
        ← Voltar para as noticias
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
                  <span className="faint small" title="Categoria atribuida por IA (OpenRouter)">
                    por IA{' '}
                    {data.categoryConfidence != null ? `${Math.round(data.categoryConfidence * 100)}% de confianca` : ''}
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
            <p className="muted small">A fonte nao disponibilizou o texto completo; resuma pelo link original.</p>
          )}

          <p style={{ marginTop: 'var(--sp-5)' }}>
            <a className="button" href={data.url} target="_blank" rel="noopener noreferrer">
              Ler a noticia original em {hostFromUrl(data.url)} ↗
            </a>
          </p>
        </article>

        <aside className="detail__aside">
          <SummaryPanel articleId={data.id} />
        </aside>
      </div>
    </>
  );
}
