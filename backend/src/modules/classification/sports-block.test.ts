import { describe, expect, it } from 'vitest';
import { isSportsContent } from './sports-block.js';

describe('isSportsContent', () => {
  it('bloqueia futebol e derivados', () => {
    expect(isSportsContent('Flamengo vence clássico e assume a liderança do Brasileirão')).toBe(true);
    expect(isSportsContent('Brasil faz 3 gols no segundo tempo e goleia')).toBe(true);
    expect(isSportsContent('Campeonato Brasileiro: tabela e artilharia deste domingo')).toBe(true);
  });

  it('bloqueia automobilismo mesmo em inglês', () => {
    expect(isSportsContent('Fórmula 1: Norris domina treino livre na Argentina')).toBe(true);
    expect(isSportsContent('Norris apologises to Colapinto after dramatic Argentine Grand Prix')).toBe(true);
    expect(isSportsContent('MotoGP anuncia calendário com novas etapas')).toBe(true);
  });

  it('bloqueia outros esportes e olimpíadas', () => {
    expect(isSportsContent('British chess prodigy becomes youngest woman grandmaster')).toBe(true);
    expect(isSportsContent('Olimpíadas 2026: Brasil define delegação')).toBe(true);
    expect(isSportsContent('Tênis: brasileiro cai nas quartas em Roland Garros')).toBe(true);
    expect(isSportsContent('NBA: campanha das estrelas termina empatada')).toBe(true);
    expect(isSportsContent('Copa do Mundo de 2026 se aproxima')).toBe(true);
    expect(isSportsContent('Campeonato de xadrez decide o título')).toBe(true);
  });

  it('casa com o termo mesmo vindo só da descricao (titulo + descricao jogados juntos)', () => {
    expect(isSportsContent('Reta final decisiva ' + 'Equipes do Grande Prêmio de Fórmula 1 aceleram neste fim de semana')).toBe(true);
  });

  it('falsos positivos: politica/apostas nao podem ser bloqueados', () => {
    expect(isSportsContent('Governo proíbe bets e apostas esportivas; projeto segue ao Senado')).toBe(false);
    expect(isSportsContent('Corrida eleitoral esquenta com novas pesquisas')).toBe(false);
    expect(isSportsContent('Rússia reforça-se com tropas e mísseis norte-coreanos')).toBe(false);
    expect(isSportsContent('TJMT retoma expediente, mas mantém prazos suspensos')).toBe(false);
    expect(isSportsContent('Major morto a tiros no Amapá deixa 5 filhos')).toBe(false);
  });

  it('falsos positivos: palavras parecidas com esporte mas de outro sentido', () => {
    expect(isSportsContent('Golpe contra a democracia foi frustrado')).toBe(false);
    expect(isSportsContent('Estoque de armas: arsenal nuclear dos EUA cresce')).toBe(false);
    expect(isSportsContent('Escalada da violência preocupa autoridades')).toBe(false);
    expect(isSportsContent('Partida de voo atrasada em Guarulhos')).toBe(false);
    expect(isSportsContent('Maratona de reuniões define o orçamento')).toBe(false);
  });

  it('falsos positivos descobertos na auditoria ao vivo (nao podem cair)', () => {
    // "fluminense" e adjetivo do estado do RJ (derrubava politica/crime/meio ambiente)
    expect(isSportsContent('Polo eleitoral de Itaperuna entra na reta final no Noroeste Fluminense')).toBe(false);
    expect(isSportsContent('Colisão deixa feridos em Natividade, no Noroeste Fluminense')).toBe(false);
    // "liverpool" e cidade inglesa (derrubava politica britanica)
    expect(isSportsContent('Burnham has a battle plan, with social care the flagship in Liverpool')).toBe(false);
    // "squash" e legume em receitas
    expect(isSportsContent('Autumn food stars: what to cook, plant and pick now (squash and kale)')).toBe(false);
    // "rally" e alta em financas
    expect(isSportsContent('House prices rally ahead of budget, says Halifax')).toBe(false);
    // "olimpiada" (singular) e usada para competicao escolar/gastronomica
    expect(isSportsContent('Estudantes vencem a Olimpíada Brasileira de Matemática')).toBe(false);
    expect(isSportsContent('Pizzaiola ganha prêmio em Olimpíada de pizza na Itália')).toBe(false);
  });

  it('borda de palavra: termo dentro de palavra maior nao casa', () => {
    expect(isSportsContent('A pratica de esquiar nas montanhas')).toBe(false);
    expect(isSportsContent('o futebolista se machucou no treino')).toBe(false);
  });
});