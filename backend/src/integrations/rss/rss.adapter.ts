import Parser from 'rss-parser';
import { ExternalServiceError } from '../../core/errors.js';
import { fetchWithTimeout } from '../../core/http.js';
import type { SourceRecord } from '../../modules/sources/sources.types.js';
import type { FeedResult, FeedLoader, RawItem } from './rss.types.js';

/**
 * rss-parser normaliza tags para minusculas, por isso os customFields abaixo.
 * `media:content`/`media:thumbnail` chegam como { $: { url, ... } }.
 */
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['dc:creator', 'creator'],
      ['dc:date', 'dcDate'],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

const first = <T>(value: T | T[] | undefined): T | undefined => (Array.isArray(value) ? value[0] : value);

export async function parseFeed(xml: string): Promise<RawItem[]> {
  try {
    const feed = await parser.parseString(xml);
    return (feed.items ?? []) as unknown as RawItem[];
  } catch (error) {
    throw new ExternalServiceError('FEED_INVALID_XML', `Feed invalido: ${(error as Error).message}`);
  }
}

/**
 * Baixa o feed respeitando cache condicional (ETag / If-Modified-Since): um 304
 * significa "nada novo" e nao consome banda nem gera execucao de ingestao.
 */
export function createFeedLoader(options: { timeoutMs: number; maxBytes: number }): FeedLoader {
  return async (source: SourceRecord): Promise<FeedResult> => {
    const headers: Record<string, string> = { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' };
    if (source.etag) headers['if-none-match'] = source.etag;
    if (source.lastModified) headers['if-modified-since'] = source.lastModified;

    const response = await fetchWithTimeout(source.feedUrl, {
      headers,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes,
    });

    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');

    if (response.status === 304) {
      return { notModified: true, etag, lastModified };
    }
    if (!response.ok) {
      throw new ExternalServiceError('FEED_HTTP_ERROR', `Feed ${source.name} respondeu HTTP ${response.status}`);
    }

    const xml = await response.text();
    if (xml.length > options.maxBytes) {
      throw new ExternalServiceError('FEED_TOO_LARGE', `Feed ${source.name} excedeu ${options.maxBytes} bytes`);
    }

    return { notModified: false, status: response.status, etag, lastModified, items: await parseFeed(xml) };
  };
}

export { first };
