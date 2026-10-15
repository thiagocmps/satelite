import type { Article } from '../news/news.types.js';
import type { NewsGroup } from './saved.repository.js';

/**
 * Export de uma colecao em Markdown legivel — formato UNICO (o mesmo do
 * export simples e do ZIP de todas as colecoes): `## Colecao` ->
 * `### Noticia` -> link com dominio -> anotacao em paragrafo puro, sem
 * marcador (e so digitar mais uma linha abaixo para acrescentar). Sem
 * descricao nem resumo: e um documento de leitura, nao um dump de banco.
 *
 * Puro e sem I/O de lado nenhum: o controller so cuida do content-disposition.
 */

const MAX_ARTICLES = 500;

const escapeMd = (text: string): string => text.replace(/([\\`*_[\]])/g, '\\$1');

/** "estilozinho": link com o dominio legivel e seta; URL completa no alvo. */
function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host ? `${host} ↗` : 'Ler original ↗';
  } catch {
    return 'Ler original ↗';
  }
}

export function buildCollectionMarkdown(group: NewsGroup, articles: Article[]): string {
  const list = articles.slice(0, MAX_ARTICLES);
  const lines: string[] = [];

  lines.push(`## ${escapeMd(group.name)}`);
  lines.push('');

  for (const [index, article] of list.entries()) {
    if (index > 0) {
      lines.push('---');
      lines.push('');
    }
    lines.push(`### ${escapeMd(article.title)}`);
    lines.push('');
    lines.push(`[${linkLabel(article.url)}](${article.url})`);
    lines.push('');
    if (article.note?.trim()) {
      // paragrafo puro, sem marcador e sem escape: anotacao e texto de leitura
      lines.push(article.note.trim());
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
