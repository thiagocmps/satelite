import { createHash } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Titulo normalizado para comparacao: minusculo, sem acentos, sem pontuacao e
 * com espacos colapsados. Base do fingerprint de deduplicacao.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Chave de deduplicacao entre fontes: hash do titulo normalizado. */
export function titleFingerprint(title: string): string {
  return sha256(normalizeTitle(title));
}

/** Remove fragmento e barra final, normaliza o host: mesma noticia = mesma URL. */
export function canonicalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

export function urlHash(url: string): string {
  return sha256(canonicalizeUrl(url));
}
