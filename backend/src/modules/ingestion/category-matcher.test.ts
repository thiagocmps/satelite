import { describe, expect, it } from 'vitest';
import { buildCategoryIndex, matchCategory } from './category-matcher.js';

const index = buildCategoryIndex([
  { categoryId: 'tech', keyword: 'ia' },
  { categoryId: 'tech', keyword: 'inteligencia artificial' },
  { categoryId: 'space', keyword: 'nasa' },
]);

describe('buildCategoryIndex', () => {
  it('ordena da palavra mais longa para a mais curta', () => {
    expect(index.map((rule) => rule.keyword)).toEqual(['inteligencia artificial', 'nasa', 'ia']);
  });

  it('remove duplicatas e keywords curtas demais', () => {
    const built = buildCategoryIndex([
      { categoryId: 'a', keyword: 'Notícia' },
      { categoryId: 'a', keyword: 'noticia' },
      { categoryId: 'b', keyword: 'x' },
    ]);
    expect(built).toHaveLength(1);
    expect(built[0]?.keyword).toBe('noticia');
  });
});

describe('matchCategory', () => {
  it('encontra a regra mais especifica', () => {
    expect(matchCategory('Nova inteligencia artificial da OpenAI', index)).toBe('tech');
  });

  it('e case-insensitive e ignora acentos na regra', () => {
    const built = buildCategoryIndex([{ categoryId: 'br', keyword: 'saude publica' }]);
    expect(matchCategory('SAÚDE Pública em alta', built)).toBe('br');
  });

  it('devolve null sem match', () => {
    expect(matchCategory('assunto sem relacao', index)).toBeNull();
  });

  it('devolve null com indice vazio', () => {
    expect(matchCategory('qualquer texto', [])).toBeNull();
  });
});
