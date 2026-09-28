import { stripHtml, truncate } from '../../core/html.js';
import type { ChatMessage, SummarizeInput } from './ai.provider.js';

export function systemPrompt(language: string): string {
  return [
    'Voce e um editor de noticias que escreve resumos objetivos.',
    `Escreva o resumo em ${language}, em 2 ou 3 frases, no maximo 60 palavras.`,
    'Use apenas fatos presentes no texto fornecido. Nao invente numeros, nomes ou citacoes.',
    'Responda somente com o resumo: sem titulo, sem markdown, sem aspas, sem introducoes como "Aqui esta o resumo".',
  ].join(' ');
}

export function buildMessages(input: SummarizeInput, options: { language: string; maxContentChars: number }): ChatMessage[] {
  const parts = [`Titulo: ${input.title}`];
  if (input.description) parts.push(`Descricao: ${truncate(stripHtml(input.description), 600)}`);
  if (input.content) parts.push(`Texto: ${truncate(stripHtml(input.content), options.maxContentChars)}`);

  return [
    { role: 'system', content: systemPrompt(options.language) },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

const PREFIXES = /^(aqui (est[aá] |e )?(o )?resumo|resumo|summary)\s*[:\-–]\s*/i;

/** Remove cercas de markdown, aspas e prefixos de conversa que os modelos ajudam a acrescentar. */
export function sanitizeSummary(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/```[\w-]*\n?/g, ' ')
    .replace(/^#{1,6}\s*/gm, ' ')
    .replace(/^>\s?/gm, ' ')
    .replace(/[*_`]/g, '')
    .replace(PREFIXES, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
