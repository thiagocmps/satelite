import { stripHtml } from '../../core/html.js';

/**
 * Camada deterministica da categorizacao (keyword rules). Matching em borda de
 * palavra sobre texto normalizado (minusculo, sem acentos e com espacos unicos).
 *
 * Diferente do matcher antigo, devolve TODOS os candidatos: um unico = decisao
 * forte (keyword); mais de um = ambiguo (IA decide); nenhum = ausente (IA decide,
 * se houver texto suficiente). Evolucao do motor so toca aqui.
 */
export type KeywordRule = { categoryId: string; keyword: string };

export type KeywordIndex = KeywordRule[];

export type KeywordMatch = { categoryId: string; keyword: string };

export type KeywordResult =
  | { decision: 'decisive'; match: KeywordMatch }
  | { decision: 'ambiguous'; matches: KeywordMatch[] }
  | { decision: 'none' };

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Caracteres que contam como palavra: o keyword precisa ficar isolado. */
const WORD = /[a-z0-9]/;

/** true se `keyword` ocorre no texto em alguma posicao com bordas de palavra. */
function findsWordBoundaries(text: string, keyword: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(keyword, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : text[at - 1]!;
    const after = text[at + keyword.length] ?? '';
    if (!WORD.test(before) && !WORD.test(after)) return true;
    from = at + 1;
  }
}

export function buildKeywordIndex(rules: KeywordRule[]): KeywordIndex {
  const seen = new Set<string>();
  const index: KeywordRule[] = [];

  for (const rule of rules) {
    const keyword = normalize(rule.keyword);
    if (keyword.length < 2) continue;
    const key = `${rule.categoryId}:${keyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    index.push({ categoryId: rule.categoryId, keyword });
  }

  return index.sort((a, b) => b.keyword.length - a.keyword.length);
}

export function classifyText(text: string, index: KeywordIndex): KeywordResult {
  const normalized = normalize(text);
  const byCategory = new Map<string, string>(); // categoryId -> keyword mais especifica

  for (const rule of index) {
    if (byCategory.has(rule.categoryId)) continue; // mais longa ja venceu para esta categoria
    if (!findsWordBoundaries(normalized, rule.keyword)) continue;
    byCategory.set(rule.categoryId, rule.keyword);
  }

  const matches = [...byCategory.entries()].map(([categoryId, keyword]) => ({ categoryId, keyword }));
  if (matches.length === 0) return { decision: 'none' };
  if (matches.length === 1) return { decision: 'decisive', match: matches[0]! };
  return { decision: 'ambiguous', matches };
}

/**
 * Texto da camada deterministica: titulo + descricao apenas. O conteudo nao
 * entra aqui para a keyword nao casar com palavras enterradas no corpo da
 * noticia (falsos positivos). Controle de escopo no ingestao/classificacao.
 */
export function buildKeywordText(article: {
  title: string;
  description: string | null;
}): string {
  return [article.title, article.description ?? '']
    .map((part) => stripHtml(part))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto completo (titulo + descricao + conteudo) para o prompt da IA. */
export function buildArticleText(article: {
  title: string;
  description: string | null;
  content: string | null;
}): string {
  return [article.title, article.description ?? '', article.content ?? '']
    .map((part) => stripHtml(part))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}