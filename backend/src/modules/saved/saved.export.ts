import type { Article } from '../news/news.types.js';
import type { NewsGroup } from './saved.repository.js';

/**
 * Export de uma colecao em Markdown legivel. E um documento de leitura (um
 * arquivo pra abrir em qualquer editor ou mandar pra alguem), nao um dump de
 * banco: por isso leve (sem `content`), com data legivel e resumo quando existe.
 *
 * Puro e sem I/O de lado nenhum: o controller so cuida do content-disposition.
 */

const MAX_ARTICLES = 500;

const escapeMd = (text: string): string => text.replace(/([\\`*_[\]])/g, '\\$1');

/** Data por extenso, sem depender de locale do runtime. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const months = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  return `${date.getUTCDate()} de ${months[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}

export function buildCollectionMarkdown(group: NewsGroup, articles: Article[]): string {
  const list = articles.slice(0, MAX_ARTICLES);
  const lines: string[] = [];

  lines.push(`# ${escapeMd(group.name)}`);
  lines.push('');
  lines.push(
    `${list.length} ${list.length === 1 ? 'notícia' : 'notícias'} · exportado de Satelite em ${formatDate(new Date().toISOString())}`,
  );
  lines.push('');

  for (const [index, article] of list.entries()) {
    const source = article.source.siteUrl
      ? `[${escapeMd(article.source.name)}](${article.source.siteUrl})`
      : escapeMd(article.source.name);
    const category = article.category ? ` · ${escapeMd(article.category.name)}` : '';

    lines.push(`## ${index + 1}. ${escapeMd(article.title)}`);
    lines.push('');
    lines.push(`${source} · ${formatDate(article.publishedAt)}${category}`);
    lines.push('');
    if (article.summary?.text) {
      lines.push(`> ${escapeMd(article.summary.text)}`);
      lines.push('');
    }
    if (article.description) {
      lines.push(escapeMd(article.description));
      lines.push('');
    }
    lines.push(`[Ler original](${article.url})`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
