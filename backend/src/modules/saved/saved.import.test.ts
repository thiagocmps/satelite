import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../core/errors.js';
import type { Article } from '../news/news.types.js';
import { buildCollectionMarkdown } from './saved.export.js';
import { parseCollectionMarkdown } from './saved.import.js';
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
