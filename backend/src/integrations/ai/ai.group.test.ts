import { describe, expect, it } from 'vitest';
import { buildSuggestGroupMessages, parseGroupSuggestion } from './ai.group.js';

const groups = [
  { id: 'g-1', name: 'Eleicoes 2026 Brasil' },
  { id: 'g-2', name: 'Exploracao espacial' },
];

const input = {
  title: 'Lula e Bolsonaro disputam o segundo turno',
  description: 'Eleicao presidencial de 2026.',
  content: 'Texto completo com muitos detalhes sobre a disputa.',
  groups,
};

describe('buildSuggestGroupMessages', () => {
  it('lista os grupos existentes e exige JSON', () => {
    const [system, user] = buildSuggestGroupMessages(input, { language: 'pt-BR', maxContentChars: 500 });
    expect(system?.content).toContain('groupId');
    expect(system?.content).toContain('newGroupName');
    expect(user?.content).toContain('- g-1: Eleicoes 2026 Brasil');
    expect(user?.content).toContain('Titulo: Lula e Bolsonaro disputam o segundo turno');
  });

  it('avisa quando nenhum grupo existe ainda', () => {
    const [, user] = buildSuggestGroupMessages({ ...input, groups: [] }, { language: 'pt-BR', maxContentChars: 500 });
    expect(user?.content).toContain('nenhum grupo criado ainda');
  });
});

describe('parseGroupSuggestion', () => {
  it('aceita um grupo conhecido', () => {
    expect(parseGroupSuggestion('{"groupId":"g-1","newGroupName":null,"confidence":0.9}', groups, 0.6)).toEqual({
      groupId: 'g-1',
      newGroupName: null,
      confidence: 0.9,
    });
  });

  it('remove cercas de markdown e ruido ao redor', () => {
    const raw = 'Claro:\n```json\n{"groupId":"g-2","newGroupName":null,"confidence":0.8}\n```';
    expect(parseGroupSuggestion(raw, groups, 0.6)).toMatchObject({ groupId: 'g-2' });
  });

  it('descarta id fora da lista e cai para o nome novo', () => {
    const raw = '{"groupId":"g-nao-existe","newGroupName":"Copa do Mundo 2026","confidence":0.9}';
    expect(parseGroupSuggestion(raw, groups, 0.6)).toEqual({
      groupId: null,
      newGroupName: 'Copa do Mundo 2026',
      confidence: 0.9,
    });
  });

  it('nao sugere nada abaixo do piso de confianca', () => {
    expect(parseGroupSuggestion('{"groupId":"g-1","newGroupName":null,"confidence":0.3}', groups, 0.6)).toEqual({
      groupId: null,
      newGroupName: null,
      confidence: 0.3,
    });
  });

  it('ignora nome novo curto demais', () => {
    const raw = '{"groupId":null,"newGroupName":"x","confidence":0.9}';
    expect(parseGroupSuggestion(raw, groups, 0.6)).toEqual({ groupId: null, newGroupName: null, confidence: 0.9 });
  });

  it('devolve null para resposta ilegivel', () => {
    expect(parseGroupSuggestion('nao e json', groups, 0.6)).toBeNull();
    expect(parseGroupSuggestion('', groups, 0.6)).toBeNull();
  });
});
