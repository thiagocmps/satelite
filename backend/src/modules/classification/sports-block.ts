/**
 * Filtro de conteudo esportivo. O dono do app nao quer nada de esportes: o
 * artigo que casa com qualquer termo aqui e DROPADO na ingestao (nao entra no
 * banco) e, num lote de classificacao, sai da fila sem custo de modelo.
 *
 * Regras cuidadas para evitar falsos positivos:
 * - escopo igual ao da keyword: titulo + descricao (conteudo nao bloqueia);
 * - matching em borda de palavra sobre texto normalizado (minusculo, sem
 *   acentos e com ponteuacao trocada por espaco);
 * - termos genericos ambíguos ficam de fora: "corrida", "esporte(s)",
 *   "esportiva(s)" (apostas esportivas sao POLITICA e nao devem cair aqui),
 *   "arsenal" (armas), "partida" (partida de aviao), "golpe";
 * - termos que a auditoria ao vivo mostrou derrubando POLITICA/ciencia/lazer:
 *   "fluminense" (adjetivo do estado do RJ), "liverpool" (cidade), "squash"
 *   (legume), "rally" (alta em financas), "olimpiada" (singular, usada em
 *   olimpiadas escolares e gastronomia).
 */
export const SPORTS_TERMS = [
  // futebol e competicoes
  'futebol', 'futebol americano', 'gol', 'gols', 'golaco', 'goleiro', 'goleiros',
  'copa do mundo', 'world cup', 'copa america', 'copa libertadores', 'champions league',
  'liga dos campeoes', 'eurocopa', 'premier league', 'la liga', 'man city',
  // clubes (nomes que nao colidem com cidade/lugar comum)
  'flamengo', 'palmeiras', 'corinthians', 'vasco', 'botafogo',
  'real madrid', 'juventus', 'psg', 'bayern', 'manchester united', 'man united',
  'man utd',
  // modalidades
  'basquete', 'basquetebol', 'basketball', 'nba',
  'volei', 'voleibol', 'volleyball', 'handebol', 'handball',
  'tenis', 'tennis', 'badminton', 'tenis de mesa', 'pingue pongue',
  'golfe', 'golf', 'rugbi', 'rugby', 'beisebol', 'baseball', 'criquete', 'cricket',
  'hoquei', 'hockey', 'patinacao', 'skate', 'skatista', 'surfe', 'surf', 'esqui',
  'snowboard', 'ciclismo', 'cycling', 'natacao', 'swimming', 'nado sincronizado',
  'atletismo', 'athletics', 'triatlo', 'triathlon',
  'boxe', 'boxing', 'mma', 'ufc', 'luta livre', 'jiu jitsu', 'judo', 'karate',
  'taekwondo', 'kung fu', 'capoeira', 'muay thai', 'wrestling', 'artes marciais',
  'ginastica', 'gymnastics', 'fisiculturismo', 'musculacao',
  'xadrez', 'chess', 'enxadrista', 'xeque mate',
  // automobilismo / motores
  'automobilismo', 'motociclismo', 'motogp', 'formula 1', 'formula e', 'f1',
  'nascar', 'grand prix',
  // termos de jogo
  'campeonato', 'campeonatos', 'torneio', 'torneios', 'placar', 'estadio',
  'estadios', 'arquibancada', 'torcida', 'torcedor', 'torcedores',
  // eventos
  'olimpiadas', 'olympics', 'olympic', 'jogos olimpicos',
  'paralimpiada', 'paralimpiadas', 'jogos paralimpicos', 'paralympics',
  'super bowl', 'nfl', 'esports', 'e sports',
] as const;

/** Minusculo, sem acentos e com qualquer nao-alfanumerico virando espaco unico. */
export function toAlnumSpace(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Caracteres que contam como palavra: o termo precisa ficar isolado. */
const WORD = /[a-z0-9]/;

function findsWordBoundaries(text: string, term: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(term, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : text[at - 1]!;
    const after = text[at + term.length] ?? '';
    if (!WORD.test(before) && !WORD.test(after)) return true;
    from = at + 1;
  }
}

/** true quando o texto (titulo + descricao) parece conteudo esportivo. */
export function isSportsContent(text: string): boolean {
  const haystack = toAlnumSpace(text);
  return SPORTS_TERMS.some((term) => findsWordBoundaries(haystack, term));
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Array de termos para comparação em SQL (borda de palavra do Postgres). */
export function sportsTermsForSql(): string[] {
  return SPORTS_TERMS.map((term) => term.split(' ').map(escapeRegex).join(' '));
}