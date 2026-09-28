/** Normalizacao de HTML/texto vinda dos feeds RSS. Sem dependencias: regex + named entities. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  laquo: '<<',
  raquo: '>>',
  eacute: 'é',
  ecirc: 'ê',
  atilde: 'ã',
  otilde: 'õ',
  uuml: 'ü',
  ccedil: 'ç',
  aacute: 'á',
  igrave: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  euro: '€',
  pound: '£',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
};

function decodeNumericEntity(code: string): string | undefined {
  const isHex = code.startsWith('#x') || code.startsWith('#X');
  const value = Number.parseInt(isHex ? code.slice(2) : code.slice(1), isHex ? 16 : 10);
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return undefined;
  try {
    return String.fromCodePoint(value);
  } catch {
    return undefined;
  }
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code.startsWith('#')) return decodeNumericEntity(code) ?? match;
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Remove tags (incluindo <script>/<style>) e decodifica entidades -> texto puro. */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return decodeEntities(
    input
      // CDATA aparece em varios feeds como <![CDATA[texto]]>
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** URL da primeira <img> encontrada no HTML. */
export function firstImageUrl(html: string | null | undefined): string | null {
  if (!html) return null;
  const match = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
  return match?.[1] ?? null;
}

/** Corta o texto no limite, preferring cortar em fronteira de palavra. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}
