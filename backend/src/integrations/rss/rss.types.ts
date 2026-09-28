import type { SourceRecord } from '../../modules/sources/sources.types.js';

export type MediaNode = { $?: { url?: string; type?: string; medium?: string } };

/** Item de feed ja em forma "achatada" (rss-parser baixa as tags para minusculo). */
export type RawItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  creator?: string | string[];
  'dc:creator'?: string | string[];
  dcDate?: string;
  'dc:date'?: string;
  mediaContent?: MediaNode | MediaNode[];
  mediaThumbnail?: MediaNode | MediaNode[];
  enclosure?: { url?: string; type?: string };
};

export type FeedResult =
  | { notModified: true; etag: string | null; lastModified: string | null }
  | {
      notModified: false;
      status: number;
      etag: string | null;
      lastModified: string | null;
      items: RawItem[];
    };

/** Port do dominio: onde o servico de ingestao busca itens de uma fonte. */
export type FeedLoader = (source: SourceRecord) => Promise<FeedResult>;
