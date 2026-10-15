import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Article } from '../api/types';

/**
 * Dialogo de preview do cartao de compartilhamento (portal, mesmo desenho do
 * .save__*). Mostra a imagem gerada e as acoes: folha nativa quando o
 * navegador suporta share de arquivo; sempre baixar e copiar a legenda.
 */
export function SharePreview({
  article,
  file,
  onClose,
}: {
  article: Article;
  file: File;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);

  const caption = `${article.source.name} — ${article.title}\n${article.url}`;
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  useEffect(() => {
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function share() {
    setShareError(null);
    try {
      await navigator.share({
        title: `${article.source.name} — ${article.title}`,
        text: caption,
        files: [file],
      });
    } catch (error) {
      // fechar a folha nao e erro
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareError(error instanceof Error ? error.message : 'Nao foi possivel compartilhar');
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
    } catch {
      // contexto nao seguro (http): execCommand ainda da conta na maioria
      const area = document.createElement('textarea');
      area.value = caption;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return createPortal(
    <div className="share__overlay">
      <div className="share__backdrop" onClick={onClose} role="presentation" />
      <div
        className="share__pop"
        role="dialog"
        aria-modal="true"
        aria-label="Compartilhar noticia"
        tabIndex={-1}
        ref={dialogRef}
      >
        <p className="share__title">Cartão para stories</p>

        <img className="share__preview" src={previewUrl} alt="Prévia do cartão de compartilhamento" />

        <div className="share__actions">
          {canShare ? (
            <button type="button" className="button button--sm button--primary" onClick={() => void share()}>
              Compartilhar…
            </button>
          ) : null}
          <a className="button button--sm" href={previewUrl} download={file.name}>
            Baixar imagem
          </a>
          <button type="button" className="button button--sm button--ghost" onClick={() => void copyCaption()}>
            {copied ? 'Legenda copiada ✓' : 'Copiar legenda'}
          </button>
        </div>

        {!canShare ? (
          <p className="faint small" style={{ marginTop: 'var(--sp-3)' }}>
            Este navegador não abre o compartilhamento direto — baixe a imagem e publique pelo app do
            Instagram/WhatsApp.
          </p>
        ) : null}
        {shareError ? (
          <p className="small" style={{ color: 'var(--danger)', marginTop: 'var(--sp-2)' }}>
            {shareError}
          </p>
        ) : null}

        <button
          type="button"
          className="button button--sm button--ghost"
          style={{ marginTop: 'var(--sp-3)', width: '100%' }}
          onClick={onClose}
        >
          Fechar
        </button>
      </div>
    </div>,
    document.body,
  );
}
