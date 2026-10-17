import { useState } from 'react';
import type { Article } from '../api/types';
import { sharePhotoUrl } from '../api/satelite.api';
import { renderStoryBlob } from '../share/storyCanvas';
import { slugify } from '../utils/format';
import { SharePreview } from './SharePreview';

/**
 * Botao "compartilhar": gera o cartao 9:16 (foto via proxy same-origin, ou
 * placeholder quando nao ha foto/falha o carregamento) e abre o preview com
 * as acoes de share.
 */
export function ShareButton({ article }: { article: Article }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const photo = await loadPhoto(article.imageUrl ? sharePhotoUrl(article.id) : null);
      const blob = await renderStoryBlob({
        title: article.title,
        sourceName: article.source.name,
        categoryName: article.category?.name ?? null,
        categoryColor: article.category?.color ?? null,
        publishedAt: article.publishedAt,
        url: article.url,
        photo,
      });
      const name = `satelite-${slugify(article.source.name) || 'noticia'}-${slugify(article.title).slice(0, 40) || 'story'}.jpg`;
      setFile(new File([blob], name, { type: 'image/jpeg' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao gerar a imagem');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="share">
      <button type="button" className="button button--sm" onClick={() => void prepare()} disabled={busy}>
        {busy ? '✦ Gerando…' : '⇧ Compartilhar'}
      </button>
      {error ? (
        <span className="share__error" role="status">
          {error}
        </span>
      ) : null}
      {file ? <SharePreview article={article} file={file} onClose={() => setFile(null)} /> : null}
    </span>
  );
}

/** Carrega a foto do proxy; qualquer falha (ou timeout) vira placeholder. */
function loadPhoto(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const done = (value: HTMLImageElement | null) => resolve(value);
    img.onload = () => done(img.naturalWidth > 0 ? img : null);
    img.onerror = () => done(null);
    // resolucao tardia nao quebra o fluxo: vira placeholder. Folga acima do
    // timeout do proxy no backend (8s) para o frontend nao desistir antes.
    setTimeout(() => done(null), 9000);
    img.src = src;
  });
}
