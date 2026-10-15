import { formatDate, hostFromUrl } from '../utils/format';

/**
 * Cartao de compartilhamento (Instagram Stories / WhatsApp Status):
 * 1080x1920 (9:16) desenhado em canvas com o tema do app — ceu noturno,
 * estrelas, nebulosas e a marca. Conceito "Orbita": o app inteiro vira cartao.
 *
 * O tema e fixo (noite profunda) independentemente do modo claro/escuro do
 * aparelho: a marca e o ceu.
 *
 * Zonas seguras: IG/WhatsApp cobrem o topo (perfil/hora, ~12%) e o fundo
 * (barra de resposta, ~17%) da story — todo texto critico vive entre elas.
 */

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

/* paleta da "noite profunda" — mesma familia dos tokens */
const C = {
  bgTop: '#05070b',
  bgMid: '#0a1020',
  bgBottom: '#0c1322',
  star: '#dbe7ff',
  text: '#e9eefb',
  textMuted: '#9fadc3',
  textFaint: '#8495b1',
  accent: '#47c4f5',
  accentDeep: '#1e4fd8',
  nebula: '#a78bfa',
  nebulaDeep: '#7c3aed',
};

const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

/* geometria (constantes de projeto, nao magicas soltas) */
const MARGIN = 80;
const CONTENT_W = STORY_WIDTH - MARGIN * 2; // 920
const HEADER_Y = 228;
const HEADER_ICON = 44;
const RULE_Y = 330;
const PHOTO = { x: MARGIN, y: 360, w: CONTENT_W, h: 720, r: 30 };
const SOURCE_BASELINE = 1168;
const TITLE_TOP = 1210;
const TITLE_MAX_LINES = 4;
const TITLE_START = 64;
const TITLE_MIN = 44;
const FOOTER_BASELINE = 1568; // ancora acima da barra de resposta (~83%)

export type StoryCardInput = {
  title: string;
  sourceName: string;
  categoryName?: string | null;
  categoryColor?: string | null;
  publishedAt: string;
  url: string;
  /** Foto ja carregada (via proxy same-origin) ou null -> placeholder */
  photo: HTMLImageElement | null;
};

type Ctx = CanvasRenderingContext2D;

/* ------------------------------------------------------------ utilidades */

/** Semente deterministica: o mesmo artigo gera o mesmo ceu. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** roundRect: Chrome 99+/Safari 16.4+; sem ele, retangulo simples. */
function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Quebra texto em linhas que cabem em `maxWidth` (medido com a fonte atual). */
export function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const rawWord of text.split(/\s+/).filter(Boolean)) {
    let word = rawWord;
    // palavra maior que a linha inteira: quebra por caracteres
    while (ctx.measureText(word).width > maxWidth) {
      let cut = word.length - 1;
      while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut -= 1;
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function trimToWidth(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length - 1;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/**
 * Encaixa o titulo: desce da fonte ate caber em `maxLines` linhas; se estourar
 * mesmo no menor tamanho, corta a ultima linha com reticencias.
 */
export function fitTitle(
  ctx: Ctx,
  text: string,
  opts: { maxWidth: number; maxLines: number; startSize: number; minSize: number; step: number },
): { lines: string[]; size: number } {
  for (let size = opts.startSize; size >= opts.minSize; size -= opts.step) {
    ctx.font = `700 ${size}px ${FONT}`;
    const lines = wrapText(ctx, text, opts.maxWidth);
    if (lines.length <= opts.maxLines) return { lines, size };
  }
  ctx.font = `700 ${opts.minSize}px ${FONT}`;
  const lines = wrapText(ctx, text, opts.maxWidth).slice(0, opts.maxLines);
  // estourou as linhas: marcar o corte com reticencias (silencio pareceria
  // texto completo) — cortando chars se a ultima linha + '…' nao couber
  const last = lines[lines.length - 1];
  if (last !== undefined) lines[lines.length - 1] = trimToWidth(ctx, `${last}…`, opts.maxWidth);
  return { lines, size: opts.minSize };
}

/* --------------------------------------------------------------- desenho */

/** Glifo do SatelliteIcon.tsx redesenhado no canvas (viewBox 24). */
function drawSatellite(ctx: Ctx, cx: number, cy: number, size: number, color: string): void {
  const s = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  rrect(ctx, 9.5, 9.2, 5, 6.4, 1.3); // corpo
  ctx.stroke();
  for (const [x, y] of [
    [3.4, 10.6],
    [16.2, 10.6],
    [3.4, 13.4],
    [16.2, 13.4],
  ] as const) {
    rrect(ctx, x, y, 4.4, 1.6, 0.5); // paineis solares
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(12, 9.2);
  ctx.lineTo(12, 6.4); // antena
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(12, 4.9, 1.35, 0, Math.PI * 2); // alimentador
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(12, 4.9, 0.55, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawSky(ctx: Ctx, seedSource: string): void {
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_HEIGHT);
  bg.addColorStop(0, C.bgTop);
  bg.addColorStop(0.55, C.bgMid);
  bg.addColorStop(1, C.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  // nebulosas: bordoes radiais bem discretos
  for (const [cx, cy, radius, color, alpha] of [
    [170, 330, 640, '124,58,237', 0.2],
    [990, 1150, 720, '30,79,216', 0.15],
    [520, 1810, 600, '124,58,237', 0.12],
  ] as const) {
    const nebula = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    nebula.addColorStop(0, `rgba(${color},${alpha})`);
    nebula.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = nebula;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  const rnd = mulberry32(hashString(seedSource));
  ctx.fillStyle = C.star;
  for (let i = 0; i < 130; i += 1) {
    ctx.globalAlpha = 0.25 + rnd() * 0.7;
    ctx.beginPath();
    ctx.arc(rnd() * STORY_WIDTH, rnd() * STORY_HEIGHT, 0.6 + rnd() * rnd() * 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // meia duzia de estrelas com brilho
  ctx.shadowColor = C.star;
  ctx.shadowBlur = 14;
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.arc(rnd() * STORY_WIDTH, rnd() * STORY_HEIGHT, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawHeader(ctx: Ctx): void {
  drawSatellite(ctx, MARGIN + HEADER_ICON / 2, HEADER_Y + HEADER_ICON / 2, HEADER_ICON, C.text);

  ctx.fillStyle = C.text;
  ctx.font = `700 30px ${FONT}`;
  const spaced = ctx as Ctx & { letterSpacing?: string };
  spaced.letterSpacing = '10px';
  ctx.fillText('SATÉLITE', MARGIN + HEADER_ICON + 20, HEADER_Y + HEADER_ICON / 2 + 10);
  spaced.letterSpacing = '0px';

  // linha orbital: azul -> violeta, sumindo nas pontas
  const rule = ctx.createLinearGradient(MARGIN, 0, STORY_WIDTH - MARGIN, 0);
  rule.addColorStop(0, 'rgba(71,196,245,0)');
  rule.addColorStop(0.35, C.accent);
  rule.addColorStop(0.65, C.nebula);
  rule.addColorStop(1, 'rgba(167,139,250,0)');
  ctx.fillStyle = rule;
  ctx.fillRect(MARGIN, RULE_Y, CONTENT_W, 3);
}

function drawPhoto(ctx: Ctx, photo: HTMLImageElement | null): void {
  const { x, y, w, h, r } = PHOTO;
  ctx.save();
  rrect(ctx, x, y, w, h, r);
  ctx.clip();

  if (photo) {
    // cover fit: escala pra cobrir e centra
    const scale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
    const dw = photo.naturalWidth * scale;
    const dh = photo.naturalHeight * scale;
    ctx.drawImage(photo, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    // scrim: amarra a foto ao ceu
    const scrim = ctx.createLinearGradient(0, y + h * 0.5, 0, y + h);
    scrim.addColorStop(0, 'rgba(5,7,11,0)');
    scrim.addColorStop(1, 'rgba(5,7,11,0.55)');
    ctx.fillStyle = scrim;
    ctx.fillRect(x, y, w, h);
  } else {
    // placeholder: nebulosa + satelite grande + anel orbital (intencional, nao vazio)
    const cx = x + w / 2;
    const cy = y + h / 2;
    const glow = ctx.createRadialGradient(cx, cy, 30, cx, cy, w * 0.62);
    glow.addColorStop(0, 'rgba(124,58,237,0.30)');
    glow.addColorStop(0.6, 'rgba(30,79,216,0.12)');
    glow.addColorStop(1, 'rgba(12,19,34,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.42);
    ctx.strokeStyle = 'rgba(71,196,245,0.35)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 280, 96, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    drawSatellite(ctx, cx, cy, 250, 'rgba(219,231,255,0.92)');
  }
  ctx.restore();

  // moldura com glow azul (fora do clip)
  ctx.save();
  ctx.shadowColor = 'rgba(71,196,245,0.30)';
  ctx.shadowBlur = 44;
  rrect(ctx, x, y, w, h, r);
  ctx.strokeStyle = 'rgba(71,196,245,0.26)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawSourceRow(ctx: Ctx, input: StoryCardInput): void {
  const y = SOURCE_BASELINE;
  const textX = MARGIN + 28;

  ctx.fillStyle = input.categoryColor?.trim() || C.accent;
  ctx.beginPath();
  ctx.arc(MARGIN + 7, y - 11, 7, 0, Math.PI * 2);
  ctx.fill();

  const badgeLabel = input.categoryName?.trim() ? input.categoryName.trim().toLocaleUpperCase('pt-BR') : null;
  ctx.font = `600 24px ${FONT}`;
  const badgeWidth = badgeLabel ? Math.ceil(ctx.measureText(badgeLabel).width) + 36 : 0;

  ctx.font = `700 34px ${FONT}`;
  const name = input.sourceName.toLocaleUpperCase('pt-BR');
  const nameRoom = CONTENT_W - (textX - MARGIN) - (badgeLabel ? badgeWidth + 20 : 0);
  const shownName = trimToWidth(ctx, name, nameRoom);
  ctx.fillStyle = C.text;
  ctx.fillText(shownName, textX, y);

  if (badgeLabel) {
    const bx = textX + Math.min(ctx.measureText(name).width, nameRoom) + 20;
    if (bx + badgeWidth <= STORY_WIDTH - MARGIN) {
      ctx.font = `600 24px ${FONT}`;
      rrect(ctx, bx, y - 34, badgeWidth, 42, 21);
      ctx.strokeStyle = 'rgba(159,173,195,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = C.textMuted;
      ctx.fillText(badgeLabel, bx + 18, y - 5);
    }
  }
}

function drawTitle(ctx: Ctx, title: string): void {
  const { lines, size } = fitTitle(ctx, title, {
    maxWidth: CONTENT_W,
    maxLines: TITLE_MAX_LINES,
    startSize: TITLE_START,
    minSize: TITLE_MIN,
    step: 4,
  });
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.textBaseline = 'top';
  let y = TITLE_TOP;
  for (const line of lines) {
    ctx.fillText(line, MARGIN, y);
    y += size * 1.2;
  }
  ctx.textBaseline = 'alphabetic';
}

function drawFooter(ctx: Ctx, input: StoryCardInput): void {
  ctx.font = `500 27px ${FONT}`;
  ctx.fillStyle = C.textFaint;
  ctx.fillText(formatDate(input.publishedAt), MARGIN, FOOTER_BASELINE);
  ctx.textAlign = 'right';
  ctx.fillText(hostFromUrl(input.url), STORY_WIDTH - MARGIN, FOOTER_BASELINE);
  ctx.textAlign = 'left';
}

/**
 * Renderiza o cartao e devolve JPEG (q0.92: leve pra folha de
 * compartilhamento; texto continua nitido nessa qualidade).
 */
export async function renderStoryBlob(input: StoryCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponivel neste navegador');

  ctx.textBaseline = 'alphabetic';
  drawSky(ctx, input.url);
  drawHeader(ctx);
  drawPhoto(ctx, input.photo);
  drawSourceRow(ctx, input);
  drawTitle(ctx, input.title);
  drawFooter(ctx, input);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Nao foi possivel gerar a imagem'))),
      'image/jpeg',
      0.92,
    );
  });
}
