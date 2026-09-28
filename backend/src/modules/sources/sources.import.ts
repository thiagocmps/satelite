/**
 * Parse de arquivos de importacao de fontes — OPML (padram de listas de RSS)
 * e JSON (o backup que o proprio satelite exporta). Funcoes puras, sem banco:
 * a orquestracao com o repositorio fica em sources.import.service.ts.
 */
import { ValidationError } from '../../core/errors.js';

export type ImportCandidate = {
  name: string;
  feedUrl: string;
  siteUrl: string | null;
  categorySlug: string | null;
  enabled: boolean;
};

/** Campos do nosso export aceitos no JSON (os demais sao tolerados e ignorados). */
type JsonSource = {
  name?: unknown;
  feedUrl?: unknown;
  siteUrl?: unknown;
  enabled?: unknown;
  categorySlug?: unknown;
  /** O export do satelite embute a categoria resolvida; o slug dela vale como referencia. */
  category?: { slug?: unknown } | null;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodifica entidades XML (nome + numericas) presentes nos valores dos atributos. */
function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi,
    (whole, name: string, dec?: string, hex?: string) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return XML_ENTITIES[name.toLowerCase()] ?? whole;
    },
  );
}

/** Nome de exibicao: `text`, senao `title`, senao o host do feed. */
const opmlName = (attrs: Record<string, string | undefined>): string =>
  (attrs.text ?? attrs.title ?? '').trim() || hostOf(attrs.xmlurl ?? '');

/**
 * OPML 2.0: varre `<outline ...>` em qualquer aninhamento. Elementos sem
 * `xmlUrl` sao pastas/grupos e nao viram fonte. Limitacao razoavel: atributos
 * com `>` dentro das aspas quebrariam o scan.
 */
export function parseOpml(xml: string): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];

  const tagRe = /<outline\b[^>]*>/gi;
  const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (const tag of xml.matchAll(tagRe)) {
    const attrs: Record<string, string | undefined> = {};
    for (const match of tag[0].matchAll(attrRe)) {
      // nomes normalizados para minuscula: xmlUrl e lido como xmlurl
      attrs[match[1]!.toLowerCase()] = decodeXmlEntities((match[2] ?? match[3] ?? '').trim());
    }

    const feedUrl = attrs.xmlurl;
    if (!feedUrl) continue; // pasta ou grupo

    candidates.push({
      name: opmlName(attrs),
      feedUrl,
      siteUrl: attrs.htmlurl ?? null,
      categorySlug: attrs.category ?? null,
      enabled: true,
    });
  }

  return candidates;
}

/** Aceita o formato do proprio export (`{ data: [...] }`) ou um array cru. */
function parseJsonSources(value: unknown): JsonSource[] {
  if (Array.isArray(value)) return value as JsonSource[];
  if (typeof value === 'object' && value !== null && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data as JsonSource[];
  }
  throw new ValidationError('O JSON de importacao deve ser um array ou { data: [...] }');
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function fromJsonSource(source: JsonSource, index: number): ImportCandidate | null {
  const feedUrl = coerceString(source.feedUrl);
  if (!feedUrl) return null; // item sem feed: ignorado, como pasta no OPML

  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : hostOf(feedUrl) || `item ${index + 1}`;
  return {
    name,
    feedUrl,
    siteUrl: coerceString(source.siteUrl),
    categorySlug: coerceString(source.categorySlug) ?? coerceString(source.category?.slug),
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
  };
}

function toCandidates(items: JsonSource[]): ImportCandidate[] {
  return items.flatMap((source, index) => {
    const candidate = fromJsonSource(source, index);
    return candidate ? [candidate] : [];
  });
}

/**
 * Corpo bruto da rota: string (OPML ou JSON em texto) ou objeto ja parseado
 * pelo express.json (o backup em application/json). Detecta pelo primeiro char.
 */
export function parseImportBody(body: unknown): ImportCandidate[] {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) throw new ValidationError('O arquivo de importacao esta vazio');
    if (trimmed.startsWith('<')) return parseOpml(trimmed);
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return toCandidates(parseJsonSources(JSON.parse(trimmed)));
    }
    throw new ValidationError('Nao reconheci o formato: esperava OPML (XML) ou JSON');
  }

  return toCandidates(parseJsonSources(body));
}