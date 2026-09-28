import { describe, expect, it } from 'vitest';
import { decodeEntities, firstImageUrl, stripHtml, truncate } from './html.js';
import { canonicalizeUrl, normalizeTitle, titleFingerprint, urlHash } from './fingerprint.js';

describe('stripHtml', () => {
  it('remove tags e decodifica entidades', () => {
    expect(stripHtml('<p>Ol&aacute; mundo</p>')).toBe('Olá mundo');
  });

  it('descarta script e style', () => {
    expect(stripHtml('<style>.a{color:red}</style><p>Texto</p><script>alert(1)</script>')).toBe('Texto');
  });

  it('colapsa espacos e quebras', () => {
    expect(stripHtml('a\n\n  b<br>  c')).toBe('a b c');
  });

  it('decodifica entidades numericas decimais e hex', () => {
    expect(decodeEntities('a&#231;b&#xE3;c')).toBe('açbãc');
  });

  it('desembrulha CDATA', () => {
    expect(stripHtml('<![CDATA[<p>Texto</p> &amp; nada]]>')).toBe('Texto & nada');
  });

  it('aceita entrada vazia', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });
});

describe('firstImageUrl', () => {
  it('acha a primeira img de qualquer atributo', () => {
    expect(firstImageUrl('<p><img src="https://a.com/1.jpg" width="10">texto</p>')).toBe('https://a.com/1.jpg');
  });

  it('devolve null sem img', () => {
    expect(firstImageUrl('<p>sem imagem</p>')).toBeNull();
  });
});

describe('truncate', () => {
  it('nao corta texto curto', () => {
    expect(truncate('curto', 50)).toBe('curto');
  });

  it('corta em fronteira de palavra', () => {
    expect(truncate('uma frase bem longa para cortar', 20)).toBe('uma frase bem longa...');
  });
});

describe('normalizeTitle', () => {
  it('remove acentos, pontuacao e caixa', () => {
    expect(normalizeTitle('  Titulo: Acao & Reacao!  ')).toBe('titulo acao reacao');
  });
});

describe('deduplicacao', () => {
  it('titulos equivalentes geram o mesmo fingerprint', () => {
    expect(titleFingerprint('Mercado hoje sobe 2%')).toBe(titleFingerprint('Mercado hoje sobe 2%!'));
  });

  it('ignora acentos na comparacao', () => {
    expect(titleFingerprint('Economia nao pode esperar')).toBe(titleFingerprint('Economia nao pode esperar'));
  });

  it('titulos diferentes geram fingerprints diferentes', () => {
    expect(titleFingerprint('Noticia A')).not.toBe(titleFingerprint('Noticia B'));
  });

  it('canonicaliza URL (fragmento, barra final, host)', () => {
    expect(canonicalizeUrl('https://Example.com/noticia/#top')).toBe('https://example.com/noticia');
  });

  it('urlHash muda quando a URL muda', () => {
    expect(urlHash('https://a.com/x')).toBe(urlHash('https://a.com/x/'));
    expect(urlHash('https://a.com/x')).not.toBe(urlHash('https://a.com/y'));
  });
});
