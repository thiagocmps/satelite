import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/errors.js';
import type { Article } from '../news/news.types.js';
import { buildCollectionMarkdown } from './saved.export.js';
import { parseCollectionJson, parseCollectionMarkdown } from './saved.import.js';
import type { NewsGroup } from './saved.repository.js';

const group: NewsGroup = {
  id: '3a2b1c00-0000-4000-8000-000000000000',
  name: 'Eleições 2026',
  color: null,
  savedCount: 2,
  createdAt: new Date('2026-10-01T12:00:00.000Z'),
};

const article = (overrides: Partial<Article>): Article => ({
  id: 'a-1',
  title: 'TSE define calendário eleitoral',
  description: 'Divulgação das datas oficiais.',
  content: null,
  imageUrl: null,
  author: 'Redação',
  url: 'https://exemplo.com/tse-calendario',
  publishedAt: '2026-10-02T09:00:00.000Z',
  ingestedAt: '2026-10-02T09:05:00.000Z',
  source: { id: 's-1', slug: 'g1', name: 'G1 Globo', siteUrl: 'https://g1.globo.com' },
  category: { id: 'c-1', slug: 'politica', name: 'Política', color: null },
  categoryMethod: 'ai',
  categoryConfidence: 0.9,
  note: null,
  summary: {
    text: 'TSE divulgou o calendário.',
    generatedByAi: true,
    provider: 'openrouter',
    model: 'modelo-teste',
    promptVersion: 'v1',
    language: 'pt-BR',
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    tokensIn: 10,
    tokensOut: 5,
  },
  ...overrides,
});

describe('parseCollectionMarkdown', () => {
  it('fecha o ciclo: o export volta a ser a mesma colecao', () => {
    const articles = [
      article({}),
      article({
        id: 'a-2',
        title: 'Congresso aprova PEC da escala 6x1',
        description: null,
        url: 'https://exemplo.com/pec-escala',
        summary: null,
        source: { id: 's-2', slug: 'folha', name: 'Folha', siteUrl: null },
        category: null,
      }),
    ];

    const markdown = buildCollectionMarkdown(group, articles);
    const parsed = parseCollectionMarkdown(markdown);

    expect(parsed.name).toBe('Eleições 2026');
    expect(parsed.items.map((item) => item.url)).toEqual([
      'https://exemplo.com/tse-calendario',
      'https://exemplo.com/pec-escala',
    ]);
    expect(parsed.items[0]!.title).toBe('TSE define calendário eleitoral');
    expect(parsed.items[1]!.title).toBe('Congresso aprova PEC da escala 6x1');
  });

  it('desfaz o escape do export no nome da colecao', () => {
    const markdown = buildCollectionMarkdown({ ...group, name: 'Fatores *intrínsecos* [2026]' }, [
      article({}),
    ]);
    const parsed = parseCollectionMarkdown(markdown);
    expect(parsed.name).toBe('Fatores *intrínsecos* [2026]');
  });

  it('conta URL repetida uma unica vez (primeira ocorrencia vence)', () => {
    const markdown = buildCollectionMarkdown(group, [
      article({}),
      article({ id: 'a-2', url: 'https://exemplo.com/pec-escala' }),
    ]);
    expect(parseCollectionMarkdown(markdown).items).toHaveLength(2);

    const repeated = `${markdown}\n## 1. Repetida\n\n[Ler original](https://exemplo.com/tse-calendario)\n`;
    expect(parseCollectionMarkdown(repeated).items).toHaveLength(2);
  });

  it('aceita um Markdown escrito a mao (link solto, sem rotulo)', () => {
    const parsed = parseCollectionMarkdown(`
# Leituras de outubro

## TSE libera canal de propaganda
https://exemplo.com/noticia-um

## Outro assunto
Veja em [o site](https://exemplo.com/noticia-dois) para mais.
`);
    expect(parsed.name).toBe('Leituras de outubro');
    expect(parsed.items.map((item) => item.url)).toEqual([
      'https://exemplo.com/noticia-um',
      'https://exemplo.com/noticia-dois',
    ]);
  });

  it('descarta item sem link (nao ha como achar a noticia)', () => {
    const parsed = parseCollectionMarkdown(`
# Colecao

## Sem endereco

Texto qualquer sem URL.

## Com endereco

[Ler original](https://exemplo.com/materia)
`);
    expect(parsed.items.map((item) => item.url)).toEqual(['https://exemplo.com/materia']);

    // arquivo inteiro invalido: nada a importar, recusa com 400
    expect(() => parseCollectionMarkdown('# Colecao\n\n## Sem endereco\n\nsem URL.')).toThrow(ValidationError);
  });

  it('recusa arquivo vazio', () => {
    expect(() => parseCollectionMarkdown('   \n  ')).toThrow(/vazio/);
  });

  it('recusa arquivo sem titulo de colecao', () => {
    expect(() => parseCollectionMarkdown('## 1. Noticia\n\n[Ler original](https://x.com/a)')).toThrow(
      /titulo da colecao/,
    );
  });

  it('recusa arquivo sem noticias', () => {
    expect(() => parseCollectionMarkdown('# Colecao\n\nsó texto, nenhum bloco.')).toThrow(/nenhuma noticia/);
  });
});

describe('formato unico (H3) no import', () => {
  it('le o export atual: nome em ##, noticia em ###, anotacao em paragrafo puro', () => {
    const parsed = parseCollectionMarkdown(`
## Eleições 2026

### TSE define calendário eleitoral

[exemplo.com ↗](https://exemplo.com/tse-calendario)

Conferir se o TSE publicou a resolução.

---

### Outra matéria

[folha.com.br ↗](https://folha.com.br/outra)
`);

    expect(parsed.name).toBe('Eleições 2026');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toEqual({
      title: 'TSE define calendário eleitoral',
      url: 'https://exemplo.com/tse-calendario',
      note: 'Conferir se o TSE publicou a resolução.',
    });
    expect(parsed.items[1]!.note).toBeUndefined();
  });

  it('paragrafos da anotacao preservam a estrutura (\\n no paragrafo, \\n\\n entre eles)', () => {
    const parsed = parseCollectionMarkdown(`## Colecao

### Materia

[g1.globo.com ↗](https://g1.globo.com/x)

Primeira linha do paragrafo.
Segunda linha do mesmo paragrafo.

Segundo paragrafo, isolado por linha em branco.`);

    expect(parsed.items[0]!.note).toBe(
      'Primeira linha do paragrafo.\nSegunda linha do mesmo paragrafo.\n\nSegundo paragrafo, isolado por linha em branco.',
    );
  });

  it('URL depois do link da materia continua sendo texto da anotacao', () => {
    const parsed = parseCollectionMarkdown(`## Colecao

### Materia

[exemplo.com ↗](https://exemplo.com/A-MATERIA)

Ver também https://exemplo.com/OUTRA e [esse](https://exemplo.com/TERCEIRA).`);

    expect(parsed.items[0]!.url).toBe('https://exemplo.com/A-MATERIA');
    expect(parsed.items[0]!.note).toContain('https://exemplo.com/OUTRA');
    expect(parsed.items[0]!.note).toContain('https://exemplo.com/TERCEIRA');
  });

  it('materia sem link e descartada; arquivo sem nenhuma valida e recusado', () => {
    const parsed = parseCollectionMarkdown(`## Colecao

### Sem endereco

Texto qualquer sem URL.

### Com endereco

[exemplo.com ↗](https://exemplo.com/materia)`);
    expect(parsed.items.map((item) => item.url)).toEqual(['https://exemplo.com/materia']);

    expect(() => parseCollectionMarkdown('## Colecao\n\n### Sem endereco\n\nsem URL.')).toThrow(ValidationError);
  });

  it('URL repetida conta uma unica vez (mesma regra do legado)', () => {
    const parsed = parseCollectionMarkdown(`## Colecao

### Primeira

[exemplo.com ↗](https://exemplo.com/1)

### Segunda (mesmo endereco)

[outro.com ↗](https://exemplo.com/1)`);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.title).toBe('Primeira');
  });
});

describe('buildCollectionMarkdown (formato unico)', () => {
  it('escreve ## colecao, ### noticia, link com dominio e anotacao sem marcador', () => {
    const markdown = buildCollectionMarkdown(group, [article({ note: 'minha nota' })]);

    expect(markdown).toContain('## Eleições 2026');
    expect(markdown).toContain('### TSE define calendário eleitoral');
    expect(markdown).toContain('[exemplo.com ↗](https://exemplo.com/tse-calendario)');
    expect(markdown).toContain('minha nota');
    // paragrafo puro: sem marcador de anotacao, e so digitar uma linha abaixo
    expect(markdown).not.toContain('**Anotação:**');
    // documento de leitura, nao dump: descricao/resumo/fonte/data ficam de fora
    expect(markdown).not.toContain('Divulgação das datas oficiais.');
    expect(markdown).not.toContain('TSE divulgou o calendário.');
    expect(markdown).not.toContain('G1 Globo');
    expect(markdown).not.toContain('2 de outubro');
    // filete separa as noticias, mas nao fecha o arquivo com separador solto
    expect(markdown.trimEnd().endsWith('---')).toBe(false);
  });

  it('um unico filete entre duas noticias; colecao vazia e so o titulo', () => {
    const markdown = buildCollectionMarkdown(group, [
      article({ note: null }),
      article({ id: 'a-2', url: 'https://exemplo.com/pec-escala' }),
    ]);
    expect(markdown.match(/^---$/gm)).toHaveLength(1);

    expect(buildCollectionMarkdown(group, [])).toBe('## Eleições 2026\n');
  });
});

describe('anotações no Markdown', () => {
  it('fecha o ciclo: nota do export volta igual (incluindo multilinha e escape)', () => {
    const articles = [
      article({ note: 'Conferir se o TSE publicou a resolução.\nSegunda linha com *ênfase* e [link](https://a.b).' }),
      article({ id: 'a-2', url: 'https://exemplo.com/pec-escala', summary: null, note: null }),
    ];

    const parsed = parseCollectionMarkdown(buildCollectionMarkdown(group, articles));

    expect(parsed.items[0]!.note).toBe(
      'Conferir se o TSE publicou a resolução.\nSegunda linha com *ênfase* e [link](https://a.b).',
    );
    // nota nula não vira chave no item
    expect(parsed.items[1]!.note).toBeUndefined();
  });

  it('artigo sem nota no export nao ganha nota na importacao', () => {
    const parsed = parseCollectionMarkdown(buildCollectionMarkdown(group, [article({ note: null })]));
    expect(parsed.items[0]!.note).toBeUndefined();
  });

  it('nota vazia (só o marcador) e tratada como ausente', () => {
    const parsed = parseCollectionMarkdown(`
# Colecao

## Materia

Texto.

**Anotação:**

[Ler original](https://exemplo.com/materia)
`);
    expect(parsed.items[0]!.note).toBeUndefined();
  });

  it('URL dentro da nota nao vira a URL da materia', () => {
    const parsed = parseCollectionMarkdown(`
# Colecao

## Materia

**Anotação:**

Ver também https://exemplo.com/OUTRA e [esse](https://exemplo.com/TERCEIRA).

[Ler original](https://exemplo.com/A-MATERIA)
`);
    expect(parsed.items[0]!.url).toBe('https://exemplo.com/A-MATERIA');
    expect(parsed.items[0]!.note).toContain('https://exemplo.com/OUTRA');
  });

  it('um "[Ler original]" digitado dentro da nota fica sendo texto da nota', () => {
    const parsed = parseCollectionMarkdown(`
# Colecao

## Materia

**Anotação:**

ri do trecho "[Ler original](https://exemplo.com/fora-da-nota)" que o autor escreveu.

[Ler original](https://exemplo.com/A-MATERIA)
`);
    // a URL continua sendo a da materia (o link do export, o ultimo do bloco)
    expect(parsed.items[0]!.url).toBe('https://exemplo.com/A-MATERIA');
    // e a nota guarda o texto literal, sem cortar no link do meio
    expect(parsed.items[0]!.note).toBe(
      'ri do trecho "[Ler original](https://exemplo.com/fora-da-nota)" que o autor escreveu.',
    );
  });

  it('aceita a variante sem acento escrita a mao', () => {
    const parsed = parseCollectionMarkdown(`
# Colecao

## Materia

**Anotacao:** lembrar de comparar com o texto da PEC.

[Ler original](https://exemplo.com/materia)
`);
    expect(parsed.items[0]!.note).toBe('lembrar de comparar com o texto da PEC.');
  });
});

describe('parseCollectionJson', () => {
  it('aceita o proprio arquivo que o export emite (round-trip)', () => {
    const articles = [article({ note: 'nota multilinha:\n- um\n- dois' })];
    const exported = JSON.stringify({ data: { group, articles } });

    const parsed = parseCollectionJson(exported);

    expect(parsed.name).toBe('Eleições 2026');
    expect(parsed.items).toEqual([
      {
        title: 'TSE define calendário eleitoral',
        url: 'https://exemplo.com/tse-calendario',
        note: 'nota multilinha:\n- um\n- dois',
      },
    ]);
  });

  it('aceita o formato sem o invoclo data', () => {
    const parsed = parseCollectionJson(
      JSON.stringify({ group: { name: 'Colecao' }, articles: [{ url: 'https://exemplo.com/1' }] }),
    );
    expect(parsed.name).toBe('Colecao');
    expect(parsed.items[0]!.url).toBe('https://exemplo.com/1');
  });

  it('nota nula ou vazia vira ausente', () => {
    const parsed = parseCollectionJson(
      JSON.stringify({
        data: {
          group: { name: 'Colecao' },
          articles: [
            { url: 'https://exemplo.com/1', note: null },
            { url: 'https://exemplo.com/2', note: '   ' },
          ],
        },
      }),
    );
    expect(parsed.items.map((item) => item.note)).toEqual([undefined, undefined]);
  });

  it('preserva a data de salvamento (savedAt) quando presente', () => {
    const savedAt = '2026-09-28T10:05:00.000Z';
    const parsed = parseCollectionJson(
      JSON.stringify({
        data: { group: { name: 'Colecao' }, articles: [{ url: 'https://exemplo.com/1', savedAt }] },
      }),
    );
    expect(parsed.items[0]!.savedAt).toBe(savedAt);
  });

  it('savedAt ausente ou nulo fica sem data (banco usa now())', () => {
    const parsed = parseCollectionJson(
      JSON.stringify({
        data: {
          group: { name: 'Colecao' },
          articles: [
            { url: 'https://exemplo.com/1' },
            { url: 'https://exemplo.com/2', savedAt: null },
          ],
        },
      }),
    );
    expect(parsed.items.map((item) => item.savedAt)).toEqual([undefined, undefined]);
  });

  it('recusa savedAt que nao e data ISO', () => {
    expect(() =>
      parseCollectionJson(
        JSON.stringify({
          data: { group: { name: 'Colecao' }, articles: [{ url: 'https://exemplo.com/1', savedAt: 'ontem' }] },
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('URL repetida conta uma vez (mesma regra do Markdown)', () => {
    const parsed = parseCollectionJson(
      JSON.stringify({
        data: {
          group: { name: 'Colecao' },
          articles: [
            { url: 'https://exemplo.com/1', title: 'primeira' },
            { url: 'https://exemplo.com/1', title: 'segunda' },
          ],
        },
      }),
    );
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.title).toBe('primeira');
  });

  it('recusa JSON malformado e JSON fora do formato de exportacao', () => {
    expect(() => parseCollectionJson('{ nada')).toThrow(/malformado/);
    expect(() => parseCollectionJson(JSON.stringify({ data: { articles: [] } }))).toThrow(ValidationError);
    // articles vazio tambem e recusado (min(1) no schema)
    expect(() => parseCollectionJson(JSON.stringify({ data: { group: { name: 'X' }, articles: [] } }))).toThrow(
      ValidationError,
    );
  });
});
