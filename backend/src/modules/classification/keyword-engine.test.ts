import { describe, expect, it } from 'vitest';
import { buildArticleText, buildKeywordIndex, buildKeywordText, classifyText } from './keyword-engine.js';

const index = buildKeywordIndex([
  { categoryId: 'tech', keyword: 'ia' },
  { categoryId: 'tech', keyword: 'inteligencia artificial' },
  { categoryId: 'space', keyword: 'nasa' },
]);

describe('buildKeywordIndex', () => {
  it('ordena da palavra mais longa para a mais curta', () => {
    expect(index.map((rule) => rule.keyword)).toEqual(['inteligencia artificial', 'nasa', 'ia']);
  });

  it('remove duplicatas e keywords curtas demais', () => {
    const built = buildKeywordIndex([
      { categoryId: 'a', keyword: 'Notícia' },
      { categoryId: 'a', keyword: 'noticia' },
      { categoryId: 'b', keyword: 'x' },
    ]);
    expect(built).toHaveLength(1);
    expect(built[0]?.keyword).toBe('noticia');
  });
});

describe('classifyText', () => {
  it('e decisivo quando uma unica categoria casa', () => {
    expect(classifyText('Nova inteligencia artificial da OpenAI', index)).toEqual({
      decision: 'decisive',
      match: { categoryId: 'tech', keyword: 'inteligencia artificial' },
    });
  });

  it('e case-insensitive e ignora acentos', () => {
    const built = buildKeywordIndex([{ categoryId: 'br', keyword: 'saude publica' }]);
    const result = classifyText('SAÚDE Pública em alta', built);
    expect(result).toEqual({ decision: 'decisive', match: { categoryId: 'br', keyword: 'saude publica' } });
  });

  it('ignora keyword dentro de outra palavra (borda)', () => {
    // "nasa" nao deve casar dentro de "nasal"; "ia" nao casa em "politica"
    const result = classifyText('politica nasal do congresso', index);
    expect(result.decision).toBe('none');
  });

  it('e ambiguo quando duas categorias casam', () => {
    const result = classifyText('Nasa anuncia inteligencia artificial em foguete', index);
    expect(result.decision).toBe('ambiguous');
    if (result.decision === 'ambiguous') {
      const categories = result.matches.map((match) => match.categoryId).sort();
      expect(categories).toEqual(['space', 'tech']);
    }
  });

  it('devolve none sem match ou com indice vazio', () => {
    expect(classifyText('assunto sem relacao', index)).toEqual({ decision: 'none' });
    expect(classifyText('qualquer texto', [])).toEqual({ decision: 'none' });
  });
});

describe('buildKeywordText', () => {
  it('usa apenas titulo e descricao; conteudo nao entra na camada deterministica', () => {
    const article = {
      title: 'Titulo <b>legal</b>',
      description: '  descricao  ',
      content: 'conteudo que NAO deveria aparecer',
    };
    expect(buildKeywordText(article)).toBe('Titulo legal descricao');
  });

  it('sem descricao devolve apenas o titulo', () => {
    expect(buildKeywordText({ title: 'So titulo', description: null })).toBe('So titulo');
  });
});

describe('buildArticleText', () => {
  it('junta titulo, descricao e conteudo sem HTML e sem espacos duplos', () => {
    const text = buildArticleText({
      title: 'Titulo <b>legal</b>',
      description: '  descricao  ',
      content: 'conteudo\n\ncom      espacos',
    });
    expect(text).toBe('Titulo legal descricao conteudo com espacos');
  });
});