import type {
  AiSettings,
  VersionedAiSettingsSource,
} from '../../modules/settings/settings.types.js';
import type {
  AiProvider,
  AiSummaryResult,
  ClassifyInput,
  SuggestGroupInput,
  SummarizeInput,
} from './ai.provider.js';

/**
 * Provedor mutavel entre configuracoes. O hub guarda a instancia atual e a
 * reconstrói quando `settings.version` muda — trocar provider/modelo/chave na
 * tela de config vale na PROXIMA chamada, sem reiniciar o container. Services
 * guardam o hub, entao nada fora daqui precisa saber da troca.
 *
 * A cache de resumo/chamadas vive dentro do provider; reconstruir deixa tudo
 * fresco (modelo novo = chave de cache nova, comportamento desejado).
 */
export class AiHub implements AiProvider {
  #built: AiProvider | null = null;
  #builtVersion = -1;

  constructor(
    private readonly settings: VersionedAiSettingsSource,
    private readonly build: (settings: AiSettings) => AiProvider,
  ) {}

  get #current(): AiProvider {
    if (!this.#built || this.#builtVersion !== this.settings.version) {
      this.#built = this.build(this.settings.ai());
      this.#builtVersion = this.settings.version;
    }
    return this.#built;
  }

  get name(): string {
    return this.#current.name;
  }

  get model(): string {
    return this.#current.model;
  }

  summarize(input: SummarizeInput): Promise<AiSummaryResult> {
    return this.#current.summarize(input);
  }

  classify(input: ClassifyInput): Promise<AiSummaryResult> {
    return this.#current.classify(input);
  }

  /**
   * Espelha o provider atual: ausente = ausente (o service cai para chamadas
   * uma a uma), presente = presente. Avaliado no getter, a cada chamada.
   */
  get classifyBatch(): ((inputs: ClassifyInput[]) => Promise<AiSummaryResult>) | undefined {
    const current = this.#current;
    return current.classifyBatch?.bind(current);
  }

  suggestGroup(input: SuggestGroupInput): Promise<AiSummaryResult> {
    return this.#current.suggestGroup(input);
  }
}
