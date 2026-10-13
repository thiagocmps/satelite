import { ValidationError } from '../../core/errors.js';

/**
 * Parse do arquivo de importacao de colecao — o MESMO Markdown que o export
 * gera, para o ciclo fechar (exportar -> editar -> importar). Funcoes puras,
 * sem banco: a orquestracao com o repositorio fica em saved.service.ts.
 *
 * Tambem aceita um Markdown escrito a mao, desde que cada noticia seja um
 * bloco `## Titulo` e tenha um link (de preferencia `[Ler original](url)`).
 */
export type ParsedCollectionItem = { title: string; url: string };
export type ParsedCollection = { name: string; items: ParsedCollectionItem[] };

/** `# Nome` (um nivel so: `##` e titulo de noticia, nao da colecao). */
const H1 = /^#(?!#)\s+(.*)$/;
/** `## 1. Titulo` — o export numera; o numero e opcional aqui. */
const H2 = /^##(?!#)\s+(.*)$/;
/** O rotulo que o export escreve antes da URL da noticia. */
const LER_ORIGINAL = /\[Ler original\]\((.+)\)\s*$/i;
/** Alvo de link markdown, tolerando um nivel de parenteses na propria URL. */
const MD_LINK_TARGET = /\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/;
/** URL solta numa linha. */
const BARE_URL = /https?:\/\/[^\s)<>"']+/;

/** Desfaz o escape que o export aplica no titulo (`\*` -> `*`). */
function unescapeMd(value: string): string {
  return value.replace(/\\([\\`*_[\]])/g, '$1');
}

function titleOf(line: string): string {
  return unescapeMd(line.replace(/^\d+\.\s*/, '')).trim();
}

/**
 * URL da materia dentro do bloco. Varre as linhas guardando o ULTIMO
 * candidato: no formato do export a fonte vem no comeco e o link da materia
 * no fim; num arquivo escrito a mao o link costuma ser o unico. Linha citada
 * (`>`) e ignorada — o resumo pode trazer URL que nao e a da materia.
 *
 * O rotulo `[Ler original]` do export tem prioridade quando existe.
 * `null` quando nao ha link: o item e descartado.
 */
function urlOfBlock(lines: string[]): string | null {
  let labelled: string | null = null;
  let last: string | null = null;

  for (const line of lines) {
    if (line.trimStart().startsWith('>')) continue;

    const label = LER_ORIGINAL.exec(line);
    if (label) {
      if (labelled === null) labelled = label[1]!.trim();
      continue;
    }

    const link = MD_LINK_TARGET.exec(line);
    if (link) {
      last = link[1]!;
      continue;
    }

    // alem dos links ja tratados, sobra URL solta no texto
    const bare = BARE_URL.exec(line.replace(/\]\([^)]*\)/g, ' '));
    if (bare) last = bare[0].replace(/[.,;:]+$/, '');
  }

  return labelled ?? last;
}

export function parseCollectionMarkdown(markdown: string): ParsedCollection {
  const trimmed = markdown.trim();
  if (!trimmed) throw new ValidationError('O arquivo de importacao esta vazio');

  let name = '';
  const items: ParsedCollectionItem[] = [];
  const seen = new Set<string>();
  let heading: string | null = null;
  let block: string[] = [];

  const flush = () => {
    if (heading === null) return;
    const url = urlOfBlock(block);
    // sem link nao ha como achar a noticia no banco: item descartado.
    // URL repetida tambem cai aqui — primeira ocorrencia vence.
    if (url && !seen.has(url)) {
      seen.add(url);
      items.push({ title: heading || url, url });
    }
    heading = null;
    block = [];
  };

  for (const line of trimmed.split(/\r?\n/)) {
    const h1 = H1.exec(line);
    if (h1) {
      if (!name) name = unescapeMd(h1[1]!.trim());
      continue;
    }

    const h2 = H2.exec(line);
    if (h2) {
      flush();
      heading = titleOf(h2[1]!);
      continue;
    }

    if (heading !== null) block.push(line);
  }
  flush();

  if (!name) {
    throw new ValidationError('Nao encontrei o titulo da colecao: espere uma linha "# Nome da colecao"');
  }
  if (items.length === 0) {
    throw new ValidationError(
      'Nao encontrei nenhuma noticia no arquivo: cada uma precisa de um bloco "## Titulo" com o link',
    );
  }

  return { name, items };
}
