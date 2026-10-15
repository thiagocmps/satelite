import { z } from 'zod';
import { ValidationError } from '../../core/errors.js';

/**
 * Parse do arquivo de importacao de colecao — o MESMO Markdown que o export
 * gera, para o ciclo fechar (exportar -> editar -> importar). Funcoes puras,
 * sem banco: a orquestracao com o repositorio fica em saved.service.ts.
 *
 * Tambem aceita um Markdown escrito a mao, desde que cada noticia seja um
 * bloco `## Titulo` e tenha um link (de preferencia `[Ler original](url)`).
 *
 * E aceita o proprio export em JSON (backup fiel): notas multilinha com
 * formatacao sobrevivem sem passar pelo Markdown.
 */
export type ParsedCollectionItem = { title: string; url: string; note?: string };
export type ParsedCollection = { name: string; items: ParsedCollectionItem[] };

/** `# Nome` (um nivel so: `##` e titulo de noticia, nao da colecao). */
const H1 = /^#(?!#)\s+(.*)$/;
/** `## 1. Titulo` — o export numera; o numero e opcional aqui. */
const H2 = /^##(?!#)\s+(.*)$/;
/** O rotulo que o export escreve antes da URL da noticia. */
const LER_ORIGINAL = /\[Ler original\]\((.+)\)\s*$/i;
/** O rotulo da anotacao que o export escreve; tolera a forma sem acento. */
const NOTE_MARKER = /^\*\*Anota[çc][ãa]o:\*\*\s*(.*)$/i;
/** Alvo de link markdown, tolerando um nivel de parenteses na propria URL. */
const MD_LINK_TARGET = /\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/;
/** URL solta numa linha. */
const BARE_URL = /https?:\/\/[^\s)<>"']+/;

/** Desfaz o escape que o export aplica (`\*` -> `*`). */
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

/**
 * Anotacao do bloco: da linha `**Anotação:**` ate o `[Ler original]` FINAL do
 * bloco (o export sempre o escreve por ultimo; um `[Ler original]` digitado
 * dentro da propria nota fica sendo texto da nota). Pontas vazias removidas,
 * escape desfeito. `start`/`end` marcam a faixa para exclui-la da busca de URL
 * — um link dentro da nota nunca vira a URL da materia.
 */
function noteOfBlock(lines: string[]): { note: string; start: number; end: number } | null {
  const start = lines.findIndex((line) => NOTE_MARKER.test(line.trim()));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = lines.length - 1; i > start; i -= 1) {
    if (LER_ORIGINAL.test(lines[i]!)) {
      end = i;
      break;
    }
  }

  const rest = [NOTE_MARKER.exec(lines[start]!.trim())![1] ?? '', ...lines.slice(start + 1, end)];
  while (rest.length > 0 && rest[0]!.trim() === '') rest.shift();
  while (rest.length > 0 && rest[rest.length - 1]!.trim() === '') rest.pop();

  const note = unescapeMd(rest.join('\n')).trim();
  return note ? { note, start, end } : { note: '', start, end };
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
    const found = noteOfBlock(block);
    // as linhas da nota saem da busca de URL: um link na sua nota e texto, nao
    // a endereco da materia
    const linkLines = found ? [...block.slice(0, found.start), ...block.slice(found.end)] : block;
    const url = urlOfBlock(linkLines);
    // sem link nao ha como achar a noticia no banco: item descartado.
    // URL repetida tambem cai aqui — primeira ocorrencia vence.
    if (url && !seen.has(url)) {
      seen.add(url);
      const item: ParsedCollectionItem = { title: heading || url, url };
      if (found?.note) item.note = found.note;
      items.push(item);
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

  return requireItems(name, items);
}

/** Formato do export em JSON (`{ data: { group, articles } }`). */
const jsonCollectionSchema = z.object({
  data: z.object({
    group: z.object({
      name: z.string().trim().min(2).max(80),
      color: z.string().trim().nullable().optional(),
    }),
    articles: z
      .array(
        z.object({
          title: z.string().optional(),
          url: z.url(),
          note: z.string().max(2000).nullable().optional(),
        }),
      )
      .min(1),
  }),
});

/**
 * Backup fiel: o JSON exportado entra como ele proprio, sem passar pelo
 * Markdown — e o unico caminho que preserva nota multilinha com formatacao
 * sem escape. Aceita tambem o formato sem o invoclo `data` (grupo e artigos
 * direto no raiz), por ser um custo irrisorio de tolerancia.
 */
export function parseCollectionJson(raw: string): ParsedCollection {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ValidationError('O arquivo JSON esta malformado (nao consegui interpretar)');
  }

  const root = typeof body === 'object' && body !== null && 'data' in body ? body : { data: body };
  const parsed = jsonCollectionSchema.safeParse(root);
  if (!parsed.success) {
    throw new ValidationError(
      'JSON fora do formato de exportacao: espere { data: { group: { name }, articles: [ { url } ] } }',
    );
  }

  const { group, articles } = parsed.data.data;
  const items: ParsedCollectionItem[] = [];
  const seen = new Set<string>();
  for (const article of articles) {
    // URL repetida conta uma vez — mesma regra do Markdown
    if (seen.has(article.url)) continue;
    seen.add(article.url);
    const item: ParsedCollectionItem = { title: article.title?.trim() || article.url, url: article.url };
    if (article.note?.trim()) item.note = article.note;
    items.push(item);
  }

  return requireItems(group.name, items);
}

/** Nome e itens sao o minimo viavel de qualquer formato. */
function requireItems(name: string, items: ParsedCollectionItem[]): ParsedCollection {
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
