/**
 * Categorizacao por palavra-chave. Sem regex e sem embedding: matching simples
 * sobre o texto normalizado (minusculo e sem acentos), com as regras ordenadas
 * da mais especifica para a mais generica (a palavra mais longa vence).
 *
 * Evolucao natural quando o volume pedir: similarity/simhash ou embeddings (pgvector).
 */
export type CategoryRuleEntry = { categoryId: string; keyword: string };

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export function buildCategoryIndex(rules: { categoryId: string; keyword: string }[]): CategoryRuleEntry[] {
  const seen = new Set<string>();
  const index: CategoryRuleEntry[] = [];

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

export function matchCategory(haystack: string, index: CategoryRuleEntry[]): string | null {
  if (index.length === 0) return null;
  const text = normalize(haystack);
  for (const rule of index) {
    if (text.includes(rule.keyword)) return rule.categoryId;
  }
  return null;
}
