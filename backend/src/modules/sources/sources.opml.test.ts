import { describe, expect, it } from 'vitest';
import { buildOpml, escapeXml } from './sources.opml.js';
import type { SourceRecord } from './sources.types.js';

const source = (overrides: Partial<SourceRecord> = {}): SourceRecord => ({
  id: '1',
  slug: 'g1',
  name: 'G1 Globo',
  feedUrl: 'https://g1.globo.com/rss/g1/?param=1&outro=2',
  siteUrl: 'https://g1.globo.com',
  defaultCategoryId: null,
  enabled: true,
  etag: null,
  lastModified: null,
  lastFetchedAt: null,
  lastStatus: null,
  lastError: null,
  category: null,
  createdAt: new Date('2026-09-28T00:00:00Z'),
  ...overrides,
});

describe('buildOpml', () => {
  const xml = buildOpml(
    [
      source(),
      source({
        name: 'Jornal A & B <Ao vivo>',
        feedUrl: 'https://exemplo.com/feed?x="quotes"',
        siteUrl: null,
        category: { id: 'c1', slug: 'geral', name: 'Geral "Noticias"', color: null },
      }),
    ],
    { appName: 'Satelite', now: new Date('2026-09-28T10:00:00Z') },
  );

  it('gera um documento OPML 2.0 com head e uma outline por fonte', () => {
    expect(xml).toMatch(/<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<opml version="2.0">');
    expect(xml).toContain('<title>Satelite - fontes</title>');
    expect(xml).toContain('<dateCreated>Mon, 28 Sep 2026 10:00:00 GMT</dateCreated>');
    expect(xml.match(/<outline /g)).toHaveLength(2);
    expect(xml).toContain('type="rss"');
  });

  it('escapa XML em nome, url e categoria (inclusive aspas e "&" da URL)', () => {
    expect(xml).toContain('text="Jornal A &amp; B &lt;Ao vivo&gt;"');
    expect(xml).toContain('xmlUrl="https://exemplo.com/feed?x=&quot;quotes&quot;"');
    expect(xml).toContain('category="Geral &quot;Noticias&quot;"');
    expect(xml).not.toContain('&amp;amp;');
  });

  it('omite htmlUrl quando a fonte nao tem site', () => {
    expect(xml).not.toContain('htmlUrl="https://exemplo');
  });

  it('o resultado é XML valido para o navegador (sem entidade dupla)', () => {
    // a URL da primeira fonte tem & literal: escapa uma vez e nao sobra & cru
    expect(xml).toContain('xmlUrl="https://g1.globo.com/rss/g1/?param=1&amp;outro=2"');
    expect(xml).not.toContain('&amp;amp;');
    expect(xml).not.toContain('&outro');
  });
});

describe('escapeXml', () => {
  it('escapa os cinco caracteres reservados, com & primeiro', () => {
    expect(escapeXml(`<a href="x" data='y'>A & B</a>`)).toBe(
      '&lt;a href=&quot;x&quot; data=&apos;y&apos;&gt;A &amp; B&lt;/a&gt;',
    );
  });
});