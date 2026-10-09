import { stripHtml, truncate } from '../../core/html.js';
import type { ChatMessage, SuggestGroupInput } from './ai.provider.js';
import { extractJson } from './ai.classify.js';

/**
 * Prompt e parsing da sugestao de grupo. Reusa o mesmo encanamento do
 * classificador: o modelo escolhe UM grupo existente (por id) ou propoe um
 * nome novo; o parsing e puro e valida contra a lista enviada.
 */

const DESCRIPTION_MAX = 600;
const GROUPS_MAX = 60;
const NEW_NAME_MAX = 80;

export function buildSuggestGroupMessages(
  input: SuggestGroupInput,
  options: { language: string; maxContentChars: number },
): ChatMessage[] {
  const parts = [`Titulo: ${input.title}`];
  if (input.description) parts.push(`Descricao: ${truncate(stripHtml(input.description), DESCRIPTION_MAX)}`);
  if (input.content) parts.push(`Texto: ${truncate(stripHtml(input.content), options.maxContentChars)}`);

  const groups = input.groups.length
    ? input.groups
        .slice(0, GROUPS_MAX)
        .map((group) => `- ${group.id}: ${group.name}`)
        .join('\n')
    : '(nenhum grupo criado ainda)';

  return [
    { role: 'system', content: systemSuggestGroupPrompt(options.language) },
    {
      role: 'user',
      content: ['Grupos existentes:', groups, '', parts.join('\n\n'), '', 'Responda somente com o JSON da sugestao.'].join('\n'),
    },
  ];
}

function systemSuggestGroupPrompt(language: string): string {
  return [
    'Voce organiza noticias salvas em grupos tematicos de um leitor.',
    'Sugira o grupo existente mais adequado; se nenhum servir, proponha um nome curto para um grupo novo.',
    `Responda em ${language}, apenas com JSON valido: {"groupId": string ou null, "newGroupName": string ou null, "confidence": numero entre 0 e 1}.`,
    'Regras:',
    '1. Use groupId apenas com um id da lista; nunca invente ids.',
    '2. Prefira um grupo existente. Use newGroupName somente quando a noticia for de um tema realmente novo.',
    '3. Quando escolher um grupo existente, deixe newGroupName como null; quando propor um grupo novo, deixe groupId como null.',
    '4. O TITULO e a fonte principal; use a descricao e o texto apenas como apoio.',
    '5. Confidence: alta (0.8+) quando o grupo deixa claro; abaixo de 0.6 evite sugerir (responda ambos null).',
    'Exemplos (titulo -> resposta):',
    'Grupos: 11111111-1111-4111-8111-111111111111: Eleicoes 2026 Brasil',
    `"Lula e Bolsonaro disputam o segundo turno" -> {"groupId":"11111111-1111-4111-8111-111111111111","newGroupName":null,"confidence":0.92}`,
    `"Descoberta de agua em Marte surpreende cientistas" -> {"groupId":null,"newGroupName":"Exploracao espacial","confidence":0.85}`,
  ].join(' ');
}

export type GroupSuggestion = {
  groupId: string | null;
  newGroupName: string | null;
  confidence: number;
};

/**
 * Converte a resposta crua do modelo em uma sugestao. Regras:
 * - resposta ilegivel/nao-JSON -> null;
 * - `groupId` fora da lista enviada -> descartado (group id null);
 * - abaixo do piso de confianca -> ambos null;
 * - nome novo e aparado e limitado; curto demais vira null.
 */
export function parseGroupSuggestion(
  raw: string | null | undefined,
  groups: { id: string; name: string }[],
  minConfidence: number,
): GroupSuggestion | null {
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
  const confidence =
    typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.min(1, Math.max(0, record.confidence))
      : 0;

  if (confidence < minConfidence) return { groupId: null, newGroupName: null, confidence };

  const rawId = typeof record.groupId === 'string' ? record.groupId.trim() : '';
  if (rawId && groups.some((group) => group.id === rawId)) {
    return { groupId: rawId, newGroupName: null, confidence };
  }

  const rawName = typeof record.newGroupName === 'string' ? record.newGroupName.trim() : '';
  const newGroupName = rawName.length >= 2 ? rawName.slice(0, NEW_NAME_MAX) : null;
  return { groupId: null, newGroupName, confidence };
}
