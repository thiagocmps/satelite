import { canonicalizeUrl, titleFingerprint, urlHash } from '../../core/fingerprint.js';
import { firstImageUrl, stripHtml, truncate } from '../../core/html.js';
import type { NormalizedArticle } from '../../modules/news/news.types.js';
import type { SourceRecord } from '../../modules/sources/sources.types.js';
import { first } from './rss.adapter.js';
import type { MediaNode, RawItem } from './rss.types.js';

const DESCRIPTION_MAX = 600;
const CONTENT_MAX = 20_000;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i;

const mediaUrl = (node: MediaNode | MediaNode[] | undefined): string | null => {
  const url = first(node)?.$?.url;
  return url && IMAGE_EXTENSIONS.test(url) ? url : url && first(node)?.$?.medium === 'image' ? url : null;
};

const asText = (value: string | string[] | undefined): string | null => {
  const text = Array.isArray(value) ? value[0] : value;
  return text?.trim() ? text.trim() : null;
};

function pickImage(item: RawItem): string | null {
  const candidates = [
    mediaUrl(item.mediaContent),
    mediaUrl(item.mediaThumbnail),
    item.enclosure?.type?.startsWith('image/') ? (item.enclosure.url ?? null) : null,
    firstImageUrl(item.contentEncoded ?? item.content ?? null),
  ];
  return candidates.find((url): url is string => Boolean(url)) ?? null;
}

function absolute(url: string, base: string): string | null {
  try {
    const resolved = new URL(url, base);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function pickDate(item: RawItem, now: Date): Date {
  const candidates = [item.isoDate, item.pubDate, item.dcDate, item['dc:date']].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return now;
}

/**
 * Feed cru -> noticia normalizada. Retorna null para o que nao presta
 * (sem titulo, sem link valido, titulo curto demais): e melhor descartar
 * ruido na fronteira do que poluir o banco.
 */
export function normalizeItem(item: RawItem, source: SourceRecord, now = new Date()): NormalizedArticle | null {
  const title = truncate(stripHtml(item.title), 500);
  if (title.length < 3) return null;

  const rawUrl = item.link ?? item.guid;
  if (!rawUrl) return null;

  let url: string;
  try {
    url = canonicalizeUrl(rawUrl);
  } catch {
    return null;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;

  const body = item.contentEncoded ?? item.content ?? '';
  const description = truncate(stripHtml(item.contentSnippet || body), DESCRIPTION_MAX) || null;
  const content = truncate(stripHtml(body), CONTENT_MAX) || null;
  const imageUrl = pickImage(item);
  const author = asText(item.creator) ?? asText(item['dc:creator']);

  return {
    sourceId: source.id,
    categoryId: source.defaultCategoryId,
    title,
    description,
    content,
    imageUrl: imageUrl ? absolute(imageUrl, url) : null,
    author,
    url,
    urlHash: urlHash(url),
    fingerprint: titleFingerprint(title),
    publishedAt: pickDate(item, now),
  };
}
