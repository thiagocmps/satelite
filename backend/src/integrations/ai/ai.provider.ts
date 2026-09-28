/**
 * Contrato da camada de IA. O resto da aplicacao so conhece esta interface:
 * trocar OpenRouter por qualquer outro provedor (ou por um mock em teste) nao
 * encosta em services, repositories nem rotas.
 */
export type SummarizeInput = {
  title: string;
  description: string | null;
  content: string | null;
};

export type AiSummaryResult = {
  text: string;
  provider: string;
  model: string;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  latencyMs: number;
};

export interface AiProvider {
  /** Identificador estavel gravado no banco junto do resumo. */
  readonly name: string;
  /** Modelo solicitado. Faz parte da chave de cache do resumo. */
  readonly model: string;
  /** Gera o resumo. Deve lancar AppError (Timeout/ExternalService) em falha. */
  summarize(input: SummarizeInput): Promise<AiSummaryResult>;
}

export type ChatMessage = { role: 'system' | 'user'; content: string };
