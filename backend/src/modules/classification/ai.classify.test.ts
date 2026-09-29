import { describe, expect, it } from 'vitest';
import { buildClassifyMessages, parseClassifiedContent } from '../../integrations/ai/ai.classify.js';

const categories = [
  { slug: 'tecnologia', name: 'Tecnologia' },
  { slug: 'ciencia', name: 'Ciencia' },
  { slug: 'esportes', name: 'Esportes' },
];

const input = {
  title: 'Foguete decola',
  description: 'Missao a orbita lunar.',
  content: 'Texto completo com muitos detalhes.',
  categories,
};

describe('buildClassifyMessages', () => {
  it('lista o catalogo de categorias por slug e exige JSON', () => {
    const [system, user] = buildClassifyMessages(input, { language: 'pt-BR', maxContentChars: 500 });
    expect(system?.content).toContain('categorySlug');
    expect(system?.content).toContain('confidence');
    expect(user?.content).toContain('- tecnologia: Tecnologia');
    expect(user?.content).toContain('- ciencia: Ciencia');
    expect(user?.content).toContain('Titulo: Foguete decola');
  });

  it('instrui o modelo a nunca classificar esporte e a devolver null na duvida', () => {
    const [system] = buildClassifyMessages(input, { language: 'pt-BR', maxContentChars: 500 });
    expect(system?.content).toMatch(/ESPORTIVO/i);
    expect(system?.content).toContain('categorySlug: null');
    expect(system?.content).toContain('Flamengo'); // exemplo few-shot de esporte -> null
  });

  it('diz que o titulo e a fonte principal da decisao', () => {
    const [system] = buildClassifyMessages(input, { language: 'pt-BR', maxContentChars: 500 });
    expect(system?.content).toMatch(/TITULO[^.]*fonte principal/i);
  });
});

describe('parseClassifiedContent', () => {
  it('aceita JSON valido com slug conhecido e confianca no piso', () => {
    expect(parseClassifiedContent('{"categorySlug":"ciencia","confidence":0.87}', categories, 0.5)).toEqual({
      categorySlug: 'ciencia',
      confidence: 0.87,
    });
  });

  it('remove cercas de markdown e ruido ao redor', () => {
    const raw = 'Aqui vai:\n```json\n{"categorySlug":"tecnologia","confidence":0.9}\n```\nEspero ter ajudado';
    expect(parseClassifiedContent(raw, categories, 0.5)).toEqual({ categorySlug: 'tecnologia', confidence: 0.9 });
  });

  it('descarta slug fora do catalogo (nunca inventa categoria)', () => {
    expect(parseClassifiedContent('{"categorySlug":"economia","confidence":0.9}', categories, 0.5)).toEqual({
      categorySlug: null,
      confidence: 0.9,
    });
  });

  it('descarta categoria quando a confianca fica abaixo do piso', () => {
    expect(parseClassifiedContent('{"categorySlug":"ciencia","confidence":0.4}', categories, 0.5)).toEqual({
      categorySlug: null,
      confidence: 0.4,
    });
  });

  it('faz clamp da confianca fora de [0,1]', () => {
    expect(parseClassifiedContent('{"categorySlug":"ciencia","confidence":1.7}', categories, 0.5)).toEqual({
      categorySlug: 'ciencia',
      confidence: 1,
    });
    expect(parseClassifiedContent('{"categorySlug":"ciencia","confidence":-3}', categories, 0.5)).toEqual({
      categorySlug: null,
      confidence: 0,
    });
  });

  it('trata confidence ausente como 0 (sem categoria)', () => {
    expect(parseClassifiedContent('{"categorySlug":"ciencia"}', categories, 0.5)).toEqual({
      categorySlug: null,
      confidence: 0,
    });
  });

  it('aceita categorySlug null explicito', () => {
    expect(parseClassifiedContent('{"categorySlug":null,"confidence":0.3}', categories, 0.5)).toEqual({
      categorySlug: null,
      confidence: 0.3,
    });
  });

  it('devolve null para respostas ilegiveis (artigo permanece pendente)', () => {
    expect(parseClassifiedContent(null, categories, 0.5)).toBeNull();
    expect(parseClassifiedContent('', categories, 0.5)).toBeNull();
    expect(parseClassifiedContent('nao sei', categories, 0.5)).toBeNull();
    expect(parseClassifiedContent('[1,2,3]', categories, 0.5)).toBeNull();
    expect(parseClassifiedContent('{quebrado', categories, 0.5)).toBeNull();
    expect(parseClassifiedContent('{"categorySlug":42,"confidence":"alta"}', categories, 0.5)).toBeNull();
  });
});