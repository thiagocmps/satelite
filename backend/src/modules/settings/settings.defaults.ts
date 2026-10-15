import type { Env } from '../../config/env.js';
import { AI_PROVIDER_IDS } from '../../integrations/ai/ai.registry.js';
import type { AiSettings, ProviderSettings } from './settings.types.js';

/**
 * Defaults do .env por grupo. E o ponto unico onde as variaveis de ambiente
 * viram configuracao tipada — o .env continua sendo a fonte inicial (e o
 * fallback se o banco estiver vazio/invalido), o banco so sobrescreve.
 *
 * O mapa abaixo precisa cobrir todo `AI_PROVIDER_IDS` (garantido por teste):
 * provedor novo no registry = 1 linha aqui + as vars dele no env.ts.
 */
const providerFromEnv: Record<string, (env: Env) => ProviderSettings> = {
  groq: (env) => ({
    apiKey: env.GROQ_API_KEY,
    baseUrl: env.GROQ_BASE_URL,
    model: env.GROQ_MODEL,
    fallbackModels: env.GROQ_FALLBACK_MODELS,
    classifyModel: env.GROQ_CLASSIFY_MODEL,
    classifyFallbackModels: env.GROQ_CLASSIFY_FALLBACK_MODELS,
  }),
  openrouter: (env) => ({
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    model: env.AI_MODEL,
    fallbackModels: env.AI_FALLBACK_MODELS,
    classifyModel: env.AI_CLASSIFY_MODEL,
    classifyFallbackModels: env.AI_CLASSIFY_FALLBACK_MODELS,
  }),
  opencode: (env) => ({
    apiKey: env.OPENCODE_API_KEY,
    baseUrl: env.OPENCODE_BASE_URL,
    model: env.OPENCODE_MODEL,
    fallbackModels: env.OPENCODE_FALLBACK_MODELS,
    classifyModel: env.OPENCODE_CLASSIFY_MODEL,
    classifyFallbackModels: env.OPENCODE_CLASSIFY_FALLBACK_MODELS,
  }),
};

export function aiDefaults(env: Env): AiSettings {
  const providers: Record<string, ProviderSettings> = {};
  for (const id of AI_PROVIDER_IDS) {
    const build = providerFromEnv[id];
    if (!build) throw new Error(`defaults do provedor "${id}" ausentes em settings.defaults.ts`);
    providers[id] = build(env);
  }

  return {
    provider: env.AI_PROVIDER,
    fallbackProviders: env.AI_FALLBACK_PROVIDERS,
    providers,
    classify: {
      enabled: env.AI_CLASSIFY_ENABLED,
      timeoutMs: env.AI_CLASSIFY_TIMEOUT_MS,
      maxRetries: env.AI_CLASSIFY_MAX_RETRIES,
      batch: env.AI_CLASSIFY_BATCH,
      batchSize: env.AI_CLASSIFY_BATCH_SIZE,
      concurrency: env.AI_CLASSIFY_CONCURRENCY,
      minConfidence: env.AI_CLASSIFY_MIN_CONFIDENCE,
      minTextChars: env.AI_CLASSIFY_MIN_TEXT_CHARS,
      maxContentChars: env.AI_CLASSIFY_MAX_CONTENT_CHARS,
    },
    summarize: {
      language: env.AI_LANGUAGE,
      timeoutMs: env.AI_TIMEOUT_MS,
      maxRetries: env.AI_MAX_RETRIES,
      maxContentChars: env.AI_MAX_CONTENT_CHARS,
    },
    scheduler: {
      classifyEnabled: env.ENABLE_CLASSIFY_SCHEDULER,
      classifyCron: env.CLASSIFY_CRON,
    },
  };
}
