import { stripHtml, truncate } from '../../core/html.js';
import type { ChatMessage, ClassifyCategory, ClassifyInput } from './ai.provider.js';

/**
 * Prompt e parsing da classificacao por IA. So entram artigos que a keyword nao
 * conseguiu decidir; o modelo escolhe UMA categoria do catalogo real (por slug)
 * e devolve a propria confianca. Parsing e puro e testavel sem provedor.
 */

const DESCRIPTION_MAX = 600;
const CATALOG_MAX = 40;

export function buildClassifyMessages(
  input: ClassifyInput,
  options: { language: string; maxContentChars: number },
): ChatMessage[] {
  const parts = [`Titulo: ${input.title}`];
  if (input.description) parts.push(`Descricao: ${truncate(stripHtml(input.description), DESCRIPTION_MAX)}`);
  if (input.content) parts.push(`Texto: ${truncate(stripHtml(input.content), options.maxContentChars)}`);

  const catalog = input.categories
    .slice(0, CATALOG_MAX)
    .map((category) => `- ${category.slug}: ${category.name}`)
    .join('\n');

  return [
    { role: 'system', content: systemClassifyPrompt(options.language) },
    {
      role: 'user',
      content: ['Categorias disponiveis:', catalog, '', parts.join('\n\n'), '', 'Responda somente com o JSON da classificacao.'].join('\n'),
    },
  ];
}

function systemClassifyPrompt(language: string): string {
  return [
    'Voce e um classificador de noticias de um agregador de RSS.',
    'Escolha a UNICA categoria mais adequada para o artigo entre as listadas (pelos slugs).',
    `Responda em ${language}, apenas com JSON valido: {"categorySlug": string ou null, "confidence": numero entre 0 e 1}.`,
    'Use o slug exatamente como fornecido. Use null em categorySlug quando nenhuma categoria se aplica.',
    'Confidence mede a sua certeza: valores abaixo de 0.5 significam escolha incerta demais para classificar.',
    'Nao invente slugs: so os listados podem ser usados.',
  ].join(' ');
}

const JSON_FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

/** Extrai o primeiro bloco JSON valido (remove cercas e texto ao redor). */
function extractJson(raw: string): string | null {
  const fenced = JSON_FENCE.exec(raw)?.[1];
  const candidate = fenced ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return candidate.slice(start, end + 1);
}

export type ClassifyMention = { categorySlug: string | null; confidence: number };

/**
 * Converte a resposta crua do modelo em um veredito. Regras:
 * - resposta ilegivel/nao-JSON -> null (o artigo permanece pendente);
 * - slug fora do catalogo -> descartado (categorySlug null);
 * - confidence fora de [0,1] -> clamp; abaixo do piso -> categoria descartada.
 */
export function parseClassifiedContent(
  raw: string | null | undefined,
  categories: ClassifyCategory[],
  minConfidence: number,
): ClassifyMention | null {
  if (!raw) return null;
  const json = extractJson(raw);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const rawSlug = record.categorySlug;
  // categoria mal tipada (numero/objeto) = resposta fora do contrato -> pendente
  if (rawSlug !== null && (typeof rawSlug !== 'string' || rawSlug.trim() === '')) return null;

  const confidence =
    typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.min(1, Math.max(0, record.confidence))
      : 0;

  const slug = typeof rawSlug === 'string' ? rawSlug.trim() : '';
  const known = slug !== '' && categories.some((category) => category.slug === slug);
  const categorySlug = known && confidence >= minConfidence ? slug : null;

  return { categorySlug, confidence };
}