import { describe, expect, it } from 'vitest';
import { titleFingerprint, urlHash } from '../../core/fingerprint.js';
import { normalizeItem } from './rss.normalize.js';
import type { RawItem } from './rss.types.js';
import type { SourceRecord } from '../../modules/sources/sources.types.js';

const source: SourceRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'g1',
  name: 'G1',
  feedUrl: 'https://g1.globo.com/rss/g1/',
  siteUrl: 'https://g1.globo.com',
  defaultCategoryId: null,
  enabled: true,
  etag: null,
  lastModified: null,
  lastFetchedAt: null,
  lastStatus: null,
  lastError: null,
  category: null,
  createdAt: new Date('2026-01-01'),
};

const NOW = new Date('2026-09-28T12:00:00Z');

describe('normalizeItem', () => {
  it('normaliza um item completo', () => {
    const item: RawItem = {
      title: '<![CDATA[Titulo &amp; Subtitulo]]>',
      link: 'https://g1.globo.com/noticia/#top',
      isoDate: '2026-09-28T10:00:00.000Z',
      contentSnippet: '<p>Resumo da <b>noticia</b>.</p>',
      content: '<p>Resumo da <b>noticia</b>.</p><img src="https://img.com/foto.jpg">',
      creator: 'Joao da Silva',
    };

    const result = normalizeItem(item, source, NOW);

    expect(result).not.toBeNull();
    expect(result?.title).toBe('Titulo & Subtitulo');
    expect(result?.url).toBe('https://g1.globo.com/noticia');
    expect(result?.description).toBe('Resumo da noticia .');
    expect(result?.author).toBe('Joao da Silva');
    expect(result?.publishedAt.toISOString()).toBe('2026-09-28T10:00:00.000Z');
    expect(result?.imageUrl).toBe('https://img.com/foto.jpg');
    expect(result?.urlHash).toBe(urlHash('https://g1.globo.com/noticia'));
    expect(result?.fingerprint).toBe(titleFingerprint('Titulo & Subtitulo'));
    expect(result?.sourceId).toBe(source.id);
  });

  it('usa a data de dc:date quando pubDate falta', () => {
    const result = normalizeItem(
      { title: 'Sem pubDate', link: 'https://a.com/1', dcDate: '2026-09-20T08:00:00Z' },
      source,
      NOW,
    );
    expect(result?.publishedAt.toISOString()).toBe('2026-09-20T08:00:00.000Z');
  });

  it('cai para now quando nao ha data alguma', () => {
    const result = normalizeItem({ title: 'Sem data', link: 'https://a.com/2' }, source, NOW);
    expect(result?.publishedAt.toISOString()).toBe(NOW.toISOString());
  });

  it('pega imagem em media:content', () => {
    const result = normalizeItem(
      {
        title: 'Com media',
        link: 'https://a.com/3',
        mediaContent: { $: { url: 'https://cdn.com/x.jpg', medium: 'image' } },
      },
      source,
      NOW,
    );
    expect(result?.imageUrl).toBe('https://cdn.com/x.jpg');
  });

  it('resolve imagem relativa contra a URL do artigo', () => {
    const result = normalizeItem(
      { title: 'Imagem relativa', link: 'https://a.com/noticia/4', content: '<img src="/foto.png">' },
      source,
      NOW,
    );
    expect(result?.imageUrl).toBe('https://a.com/foto.png');
  });

  it('descarta item sem titulo', () => {
    expect(normalizeItem({ title: '', link: 'https://a.com/5' }, source, NOW)).toBeNull();
    expect(normalizeItem({ title: 'ab', link: 'https://a.com/5' }, source, NOW)).toBeNull();
  });

  it('descarta item sem link', () => {
    expect(normalizeItem({ title: 'Titulo valido' }, source, NOW)).toBeNull();
  });

  it('descarta item com link nao-http', () => {
    expect(normalizeItem({ title: 'Titulo', link: 'javascript:alert(1)' }, source, NOW)).toBeNull();
    expect(normalizeItem({ title: 'Titulo', link: 'ftp://a.com/x' }, source, NOW)).toBeNull();
  });

  it('aceita guid como fallback de link', () => {
    const result = normalizeItem({ title: 'Com guid', guid: 'https://a.com/g' }, source, NOW);
    expect(result?.url).toBe('https://a.com/g');
  });

  it('herda a categoria padrao da fonte', () => {
    const withCategory = { ...source, defaultCategoryId: 'categoria-1' };
    expect(normalizeItem({ title: 'Teste', link: 'https://a.com/6' }, withCategory, NOW)?.categoryId).toBe(
      'categoria-1',
    );
  });

  it('aceita creator como array', () => {
    const result = normalizeItem({ title: 'Autor', link: 'https://a.com/7', creator: ['Ana'] }, source, NOW);
    expect(result?.author).toBe('Ana');
  });
});
