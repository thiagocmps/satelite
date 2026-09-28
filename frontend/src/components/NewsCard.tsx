import { Link } from 'react-router-dom';
import type { Article } from '../api/types';
import { formatRelative, hostFromUrl } from '../utils/format';

type Props = { article: Article };

/** Card da listagem. Apenas apresentacao: recebe a noticia pronta. */
export function NewsCard({ article }: Props) {
  return (
    <article className="card news-card">
      <Link to={`/noticias/${article.id}`} aria-label={article.title}>
        <div className={`news-card__media${article.imageUrl ? '' : ' news-card__media--empty'}`}>
          {article.imageUrl ? (
            <img src={article.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span aria-hidden="true">◍</span>
          )}
        </div>
      </Link>

      <div className="news-card__body">
        <div className="chips">
          {article.category ? (
            <span className="badge badge--category">{article.category.name}</span>
          ) : null}
          {article.summary ? <span className="badge badge--ai">✦ resumo IA</span> : null}
        </div>

        <Link to={`/noticias/${article.id}`}>
          <h2 className="news-card__title">{article.title}</h2>
        </Link>

        {article.description ? <p className="news-card__excerpt">{article.description}</p> : null}

        <div className="news-card__footer">
          <span>{article.source.name}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={article.publishedAt}>{formatRelative(article.publishedAt)}</time>
          {article.author ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="faint">{article.author}</span>
            </>
          ) : null}
          <span className="spacer" />
          <span className="faint">{hostFromUrl(article.url)}</span>
        </div>
      </div>
    </article>
  );
}
