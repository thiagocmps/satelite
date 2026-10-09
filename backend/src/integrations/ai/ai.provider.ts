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

export type ClassifyCategory = { slug: string; name: string };

export type ClassifyInput = {
  title: string;
  description: string | null;
  content: string | null;
  categories: ClassifyCategory[];
};

/** Grupos existentes oferecidos ao modelo como destino possivel. */
export type SuggestGroupGroup = { id: string; name: string };

export type SuggestGroupInput = {
  title: string;
  description: string | null;
  content: string | null;
  groups: SuggestGroupGroup[];
};

export interface AiProvider {
  /** Identificador estavel gravado no banco junto do resumo. */
  readonly name: string;
  /** Modelo solicitado. Faz parte da chave de cache do resumo. */
  readonly model: string;
  /** Gera o resumo. Deve lancar AppError (Timeout/ExternalService) em falha. */
  summarize(input: SummarizeInput): Promise<AiSummaryResult>;
  /**
   * Classifica o artigo em uma das categorias permitidas. Responde JSON; o
   * texto cru (ja sem cercas de markdown) vem em `text`. Deve lancar AppError
   * em falha — a classificacao em duvida permanece pendente e tenta de novo.
   */
  classify(input: ClassifyInput): Promise<AiSummaryResult>;
  /**
   * Sugere em qual grupo salvo a noticia se encaixa — ou um nome para um grupo
   * novo. Responde o mesmo JSON cru das outras chamadas; o parsing fica no
   * service. Deve lancar AppError em falha.
   */
  suggestGroup(input: SuggestGroupInput): Promise<AiSummaryResult>;
}

export type ChatMessage = { role: 'system' | 'user'; content: string };
