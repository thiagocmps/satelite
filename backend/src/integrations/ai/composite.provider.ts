import { ExternalServiceError, TimeoutError } from '../../core/errors.js';
import type { AiProvider, AiSummaryResult, ClassifyInput, SummarizeInput } from './ai.provider.js';

/**
 * Falhas que justificam tentar o PROXIMO provedor da cadeia. Erro de credencial
 * (AI_AUTH_INVALID) ou resposta ilegivel (AI_BAD_RESPONSE) NAO trocam de
 * provedor: repetir com outra chave resolve pouco, e texto ruim nao melhora.
 */
const FAILOVER = new Set(['AI_RATE_LIMIT', 'AI_QUOTA', 'AI_UPSTREAM_ERROR', 'UPSTREAM_UNREACHABLE']);

/**
 * Cadeia de provedores de IA: tenta o primeiro e, em falha recuperavel (cota
 * zerada, limite de requisicoes, 5xx, gateway fora, timeout), tenta o proximo.
 * Se todos falharem, relanca o ULTIMO erro — assim o circuito do classificador
 * (abort no primeiro 429 geral) continua funcionando: o abort so dispara quando
 * nenhum provedor da cadeia consegue responder.
 */
export class CompositeProvider implements AiProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly providers: AiProvider[]) {
    const [primary] = providers;
    if (!primary) throw new Error('CompositeProvider precisa de pelo menos um provedor');
    this.name = primary.name;
    this.model = primary.model;
  }

  async summarize(input: SummarizeInput): Promise<AiSummaryResult> {
    return this.#run((provider) => provider.summarize(input));
  }

  async classify(input: ClassifyInput): Promise<AiSummaryResult> {
    return this.#run((provider) => provider.classify(input));
  }

  async #run(run: (provider: AiProvider) => Promise<AiSummaryResult>): Promise<AiSummaryResult> {
    let lastError: unknown;

    for (const provider of this.providers) {
      try {
        return await run(provider);
      } catch (error) {
        lastError = error;
        const canSwitchProvider =
          error instanceof TimeoutError || (error instanceof ExternalServiceError && FAILOVER.has(error.code));
        if (!canSwitchProvider) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new ExternalServiceError('AI_ERROR', 'Falha desconhecida da IA');
  }
}