/**
 * Tipos do modulo de configuracao em runtime. O contrato da UI nasce aqui:
 * `AiSettings` e o formato efetivo (defaults do .env + overrides do banco),
 * `SettingsField` descreve cada campo para a tela renderizar sem conhecer o
 * backend — acrescentar um knob = 1 linha no schema + 1 no descritor.
 */

/** Configuracao de um provedor de IA (espelha as vars GROQ_, OPENROUTER_ e OPENCODE_). */
export type ProviderSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModels: string[];
  /** Vazio = reusa `model` para classificar tambem. */
  classifyModel: string;
  classifyFallbackModels: string[];
};

export type AiSettings = {
  /** Id do provedor principal no registry (ai.registry.ts). */
  provider: string;
  /** Cadeia de fallback em ordem de tentativa (ids; sem repetir o principal). */
  fallbackProviders: string[];
  providers: Record<string, ProviderSettings>;
  /** Fila needs_ai: lote, concorrencia, cortes e o piso de confianca. */
  classify: {
    enabled: boolean;
    timeoutMs: number;
    maxRetries: number;
    /** Artigos por rodada (listPending). */
    batch: number;
    /** Artigos por requisicao de IA (lote). */
    batchSize: number;
    concurrency: number;
    minConfidence: number;
    minTextChars: number;
    /** Corte do conteudo SO no prompt de classificacao (0 = so titulo+descricao). */
    maxContentChars: number;
  };
  /** Resumo por IA sob demanda. */
  summarize: {
    language: string;
    timeoutMs: number;
    maxRetries: number;
    maxContentChars: number;
  };
  scheduler: {
    /** Cron da classificacao periodica (o de ingestao continua so no .env). */
    classifyEnabled: boolean;
    classifyCron: string;
  };
};

/** PATCH parcial (deep): so os campos enviados sao mesclados sobre o salvo. */
export type AiSettingsPatch = {
  provider?: string;
  fallbackProviders?: string[];
  providers?: Record<string, Partial<ProviderSettings>>;
  classify?: Partial<AiSettings['classify']>;
  summarize?: Partial<AiSettings['summarize']>;
  scheduler?: Partial<AiSettings['scheduler']>;
};

/**
 * Fonte injetavel dos ajustes: services leem a cada operacao, entao salvar na
 * tela vale na proxima chamada sem reiniciar nada.
 */
export type AiSettingsSource = {
  ai(): AiSettings;
};

/** Mesma fonte + versao monotonica: o AiHub usa a versao para reconstruir. */
export type VersionedAiSettingsSource = AiSettingsSource & {
  readonly version: number;
};

/** Tipo de controle que a UI deve renderizar para o campo. */
export type SettingsFieldType =
  | 'password'
  | 'string'
  | 'number'
  | 'range'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'cron'
  | 'csv';

/** Descritor de um campo: a tela renderiza por `type` sem saber a regra por tras. */
export type SettingsField = {
  /** Caminho dotted em AiSettings (ex.: providers.groq.apiKey). */
  key: string;
  section: 'provider' | 'providers' | 'classify' | 'scheduler' | 'summarize';
  /** Section 'providers': a qual card o campo pertence. */
  provider?: string;
  type: SettingsFieldType;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  /** Renderiza em "Avancado" (details) para nao poluir a tela. */
  advanced?: boolean;
  order: number;
};

export type AiProviderMeta = {
  id: string;
  label: string;
  keyUrl: string;
};

/** Resposta de GET/PATCH /settings/ai. Chaves SEMPRE mascaradas. */
export type AiSettingsView = {
  settings: AiSettings;
  /** Defaults do .env (tambem mascarados) — suporte a "restaurar padrao". */
  defaults: AiSettings;
  fields: SettingsField[];
  providers: AiProviderMeta[];
  version: number;
};
