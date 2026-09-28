import type { SourceRecord } from './sources.types.js';

/**
 * OPML 2.0 — formato padrão de listas de assinatura RSS. O navegador entende
 * `<outline type="rss" xmlUrl="…">` e permite importar direto em leitores de
 * feed (Feedly, Inoreader, Thunderbird...).
 */
export function buildOpml(sources: SourceRecord[], options: { appName: string; now?: Date }): string {
  const created = (options.now ?? new Date()).toUTCString();

  const outlines = sources.map((source) => {
    const attrs = [
      'type="rss"',
      `text="${escapeXml(source.name)}"`,
      `title="${escapeXml(source.name)}"`,
      `xmlUrl="${escapeXml(source.feedUrl)}"`,
      ...(source.siteUrl ? [`htmlUrl="${escapeXml(source.siteUrl)}"`] : []),
      ...(source.category ? [`category="${escapeXml(source.category.name)}"`] : []),
    ];
    return `    <outline ${attrs.join(' ')}/>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escapeXml(options.appName)} - fontes</title>`,
    `    <dateCreated>${escapeXml(created)}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...outlines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}

/** Escape de XML para atributos e texto (ordem importa: `&` primeiro). */
export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}