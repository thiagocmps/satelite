import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/errors.js';
import { parseImportBody, parseOpml } from './sources.import.js';

describe('parseOpml', () => {
  it('gera um candidato por outline com xmlUrl, respeitando aninhamento', () => {
    const xml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Feeds</title></head>
  <body>
    <outline text="Geral">
      <outline type="rss" text="G1 Globo" xmlUrl="https://g1.globo.com/rss/g1/" htmlUrl="https://g1.globo.com" category="geral"/>
    </outline>
    <outline type="rss" text="BBC News" xmlUrl="https://feeds.bbci.co.uk/news/rss.xml"/>
  </body>
</opml>`;

    const result = parseOpml(xml);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'G1 Globo', feedUrl: 'https://g1.globo.com/rss/g1/', siteUrl: 'https://g1.globo.com', categorySlug: 'geral', enabled: true });
    expect(result[1]!.name).toBe('BBC News');
  });

  it('usa title quando falta text; host do feed quando faltam ambos', () => {
    const xml = '<opml><body><outline type="rss" title="Jornal" xmlUrl="https://exemplo.com/feed"/></body></opml>';
    const semTitulo = '<opml><body><outline type="rss" xmlUrl="https://www.exemplo.com.br/rss"/></body></opml>';

    expect(parseOpml(xml)[0]!.name).toBe('Jornal');
    expect(parseOpml(semTitulo)[0]!.name).toBe('exemplo.com.br');
  });

  it('decodifica entidades XML em nomes e URLs', () => {
    const xml = '<opml><body><outline type="rss" text="A &amp; B &lt;ao vivo&gt;" xmlUrl="https://x.com/feed?a=1&amp;b=2"/></body></opml>';
    const result = parseOpml(xml);
    expect(result[0]!.name).toBe('A & B <ao vivo>');
    expect(result[0]!.feedUrl).toBe('https://x.com/feed?a=1&b=2');
  });

  it('aceita aspas simples nos atributos (alguns exportadores usam)', () => {
    const xml = `<opml><body><outline type='rss' text='Um Feed' xmlUrl='https://y.com/rss' htmlUrl='https://y.com'/></body></opml>`;
    expect(parseOpml(xml)[0]).toMatchObject({ name: 'Um Feed', feedUrl: 'https://y.com/rss', siteUrl: 'https://y.com' });
  });

  it('ignora pastas/grupos (outline sem xmlUrl) e elementos sem feed', () => {
    const xml = '<opml><body><outline text="Pasta"/><outline type="link" xmlUrl="" text="vazio"/></body></opml>';
    expect(parseOpml(xml)).toEqual([]);
  });
});

describe('parseImportBody', () => {
  it('detecta OPML pelo primeiro caractere `<`', () => {
    const candidates = parseImportBody('<?xml version="1.0"?><opml><body><outline type="rss" xmlUrl="https://a.com/feed"/></body></opml>');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.feedUrl).toBe('https://a.com/feed');
  });

  it('detecta JSON em texto (string com `{`)', () => {
    const body = JSON.stringify({ data: [{ slug: 'x', name: 'X', feedUrl: 'https://a.com/feed', enabled: false }] });
    const candidates = parseImportBody(body);
    expect(candidates[0]).toMatchObject({ name: 'X', feedUrl: 'https://a.com/feed', enabled: false });
  });

  it('aceita array cru como texto (`[`)', () => {
    const body = '[{"name":"Y","feedUrl":"https://b.com/rss"}]';
    expect(parseImportBody(body)[0]!.name).toBe('Y');
  });

  it('aceita objeto ja parseado pelo express.json (o export do proprio satelite)', () => {
    const candidates = parseImportBody({
      data: [{ slug: 'g1', name: 'G1', feedUrl: 'https://g1.globo.com/rss/g1/', category: { slug: 'geral' } }],
    });
    expect(candidates[0]).toMatchObject({ feedUrl: 'https://g1.globo.com/rss/g1/', categorySlug: 'geral' });
  });

  it('usa o nome do item quando presente; host como fallback para JSON', () => {
    const candidates = parseImportBody([{ feedUrl: 'https://exemplo.com/rss' }]);
    expect(candidates[0]!.name).toBe('exemplo.com');
  });

  it('ignora itens JSON sem feedUrl', () => {
    const candidates = parseImportBody([{ name: 'Sem feed' }, { name: 'Ok', feedUrl: 'https://ok.com/rss' }]);
    expect(candidates).toHaveLength(1);
  });

  it('rejeita corpo vazio e formato desconhecido', () => {
    expect(() => parseImportBody('   ')).toThrow(ValidationError);
    expect(() => parseImportBody('banana')).toThrow(ValidationError);
    expect(() => parseImportBody({ nope: true })).toThrow(ValidationError);
  });

  it('rejeita JSON em texto malformado', () => {
    expect(() => parseImportBody('{ "data": [')).toThrow();
  });
});